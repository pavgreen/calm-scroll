import {
  MessageType,
  type ExtensionMessage,
  type OffscreenClassifyRequest,
} from '../shared/messaging'
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
  message: OffscreenClassifyRequest,
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
          // A distinct message type for this leg (rather than re-sending
          // MessageType.ClassifyImageRequest with settings attached) is
          // what actually prevents this listener and offscreen's from
          // racing to answer the same broadcast — see OffscreenClassifyRequest's
          // doc comment in shared/messaging.ts. Retried because
          // createDocument() can resolve slightly before the offscreen
          // document's own script has finished registering its listener
          // ("Receiving end does not exist" race).
          const offscreenRequest: OffscreenClassifyRequest = {
            type: MessageType.OffscreenClassifyRequest,
            requestId: message.requestId,
            imageUrl: message.imageUrl,
            settings,
          }
          const response = await sendToOffscreenWithRetry(offscreenRequest)
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
