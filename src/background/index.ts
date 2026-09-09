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
const BLUR_MENU_ID = 'calm-scroll-blur-image'
const DISPLAY_MENU_ID = 'calm-scroll-display-image'

async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY)
  return (stored[SETTINGS_STORAGE_KEY] as ExtensionSettings | undefined) ?? DEFAULT_SETTINGS
}

async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings })
}

/**
 * Creates the offscreen document (if enabled) so the vision model starts
 * loading immediately, instead of on-demand when the first image actually
 * needs classifying. The model itself is ~45MB fp32 + a ~26MB WASM runtime
 * -- cold-loading and compiling that can take tens of seconds, and paying
 * that cost proactively (overlapped with normal browser/page-load activity)
 * rather than in the middle of a user's first classify request is the
 * single biggest lever on perceived speed. Once created, the offscreen
 * document and its loaded model persist independently of the service
 * worker's own idle/wake lifecycle, so this only needs to happen once per
 * browser session.
 */
async function warmUpIfEnabled(): Promise<void> {
  const settings = await getSettings()
  if (settings.enabled) await ensureOffscreenDocument()
}

chrome.runtime.onInstalled.addListener(() => {
  void getSettings().then((settings) => saveSettings(settings))
  void warmUpIfEnabled()

  // Right-click actions on any image, instead of a plain click on the image
  // itself — avoids triggering by accident on what might just be a normal
  // click (e.g. following a link). Chrome groups extension-added context
  // menu items into their own section near the bottom of the native menu
  // automatically; no positioning to configure on our end.
  //
  // Two separate, always-visible items with a fixed effect each, rather
  // than a single toggle: chrome.contextMenus.onShown (which would let the
  // menu show only the relevant one, or relabel a single item, based on the
  // image's actual current state) isn't available in the target Chrome
  // version, and there's no other reliable way to know that state before
  // the menu opens. Clicking the item that already matches the current
  // state is just a harmless no-op.
  //
  // removeAll() first: onInstalled also fires on extension update, and
  // create() with a pre-existing id throws "duplicate id" otherwise.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: BLUR_MENU_ID,
      title: 'CalmScroll - Blur Image',
      contexts: ['image'],
    })
    chrome.contextMenus.create({
      id: DISPLAY_MENU_ID,
      title: 'CalmScroll - Display Image',
      contexts: ['image'],
    })
  })
})

// onInstalled only fires on install/update, not on every browser launch --
// this is what actually warms the model up on a normal day-to-day session.
chrome.runtime.onStartup.addListener(() => {
  void warmUpIfEnabled()
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || !info.srcUrl) return
  const blurred =
    info.menuItemId === BLUR_MENU_ID ? true : info.menuItemId === DISPLAY_MENU_ID ? false : null
  if (blurred === null) return
  void chrome.tabs.sendMessage(tab.id, {
    type: MessageType.SetImageBlur,
    imageUrl: info.srcUrl,
    blurred,
  })
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
      // Covers re-enabling after the extension was off when the session
      // started (so onStartup's warm-up saw enabled:false and skipped it) --
      // ensureOffscreenDocument() is a no-op if already warm.
      if (message.settings.enabled) void ensureOffscreenDocument()
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
