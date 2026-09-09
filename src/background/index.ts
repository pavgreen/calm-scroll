import { MessageType, type ExtensionMessage } from '../shared/messaging'
import { DEFAULT_SETTINGS, type ExtensionSettings } from '../shared/categories'

/**
 * Background service worker: routes typed messages between content scripts,
 * the offscreen document, and popup/options pages, and owns settings storage.
 */

const SETTINGS_STORAGE_KEY = 'settings'
const OFFSCREEN_URL = 'src/offscreen/index.html'

async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY)
  return (stored[SETTINGS_STORAGE_KEY] as ExtensionSettings | undefined) ?? DEFAULT_SETTINGS
}

async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings })
}

chrome.runtime.onInstalled.addListener(() => {
  void getSettings().then((settings) => saveSettings(settings))
})

/**
 * Creates the offscreen document (which hosts the transformers.js vision
 * model) if it doesn't already exist. Idempotent: checks for an existing
 * context first, and tolerates the "single offscreen document" error from a
 * concurrent call racing to create it.
 */
async function ensureOffscreenDocument(): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  })
  if (existing.length > 0) return

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification:
        'Run on-device transformers.js image classification off the service worker thread.',
    })
  } catch (err) {
    if (!String(err).includes('single offscreen document')) throw err
  }
}

/**
 * Sends a message to the offscreen document's onMessage listener, retrying
 * briefly if it hasn't finished registering yet (a real race: createDocument
 * resolving doesn't guarantee the document's own script has run to that point).
 */
async function sendToOffscreenWithRetry(
  message: unknown,
  attempts = 5,
  delayMs = 150,
): Promise<unknown> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await chrome.runtime.sendMessage(message)
    } catch (err) {
      const isLastAttempt = attempt === attempts
      if (isLastAttempt || !String(err).includes('Receiving end does not exist')) throw err
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw new Error('unreachable')
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  switch (message.type) {
    case MessageType.ClassifyImageRequest: {
      // chrome.runtime.sendMessage broadcasts to every onMessage listener in
      // the extension, not just an intended recipient — so the offscreen
      // document's own listener also sees this SAME message on its way in
      // from the content script, and background's OWN outgoing relay (with
      // settings attached, below) loops back to this very listener too.
      // `settings` presence discriminates: only messages WITHOUT it are
      // genuine incoming content-script requests for background to handle;
      // ones background already relayed (with settings) get ignored here.
      if (message.settings) return false
      void (async () => {
        try {
          const settings = await getSettings()
          if (!settings.enabled) {
            sendResponse({
              type: MessageType.ClassifyImageResponse,
              requestId: message.requestId,
              isSensitive: false,
              scores: {},
              matchedCategories: [],
            })
            return
          }
          await ensureOffscreenDocument()
          // chrome.runtime.sendMessage from background to the offscreen
          // document's own onMessage listener is itself a scoped request/
          // response round trip, so the result can just be relayed directly —
          // no separate correlation table is needed for this 1:1 proxy.
          // Retried because createDocument() can resolve slightly before the
          // offscreen document's own script has finished registering its
          // onMessage listener ("Receiving end does not exist" race).
          const response = await sendToOffscreenWithRetry({ ...message, settings })
          sendResponse(response)
        } catch (err) {
          console.error('[calm-scroll/background] classify request failed:', err)
          sendResponse({
            type: MessageType.ClassifyImageResponse,
            requestId: message.requestId,
            isSensitive: false,
            scores: {},
            matchedCategories: [],
            error: String(err),
          })
        }
      })()
      return true
    }
    case MessageType.GetSettings: {
      void getSettings().then((settings) => {
        sendResponse({ type: MessageType.GetSettingsResponse, settings })
      })
      return true
    }
    case MessageType.SettingsUpdated: {
      void saveSettings(message.settings).then(() => sendResponse(undefined))
      return true
    }
    case MessageType.OffscreenReady: {
      return false
    }
    default: {
      return false
    }
  }
})
