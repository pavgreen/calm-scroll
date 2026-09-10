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
const TOGGLE_MENU_ID = 'calm-scroll-toggle-image-blur'
const BLUR_CSS_SCRIPT_ID = 'calm-scroll-blur-css'
const BLUR_CSS_PATH = 'content/blur.css'

/**
 * Merges stored settings over DEFAULT_SETTINGS field-by-field, rather than
 * an all-or-nothing fallback -- a settings object saved before a new field
 * (like startupDisplay) existed would otherwise come back with that field
 * `undefined` forever, since chrome.storage just returns whatever shape was
 * last written. This makes adding a new setting later safe without a
 * dedicated migration step each time.
 */
async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY)
  const saved = stored[SETTINGS_STORAGE_KEY] as Partial<ExtensionSettings> | undefined
  return { ...DEFAULT_SETTINGS, ...saved }
}

async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings })
}

/**
 * Registers/unregisters the "blurred" startupDisplay mode's document_start
 * CSS (public/content/blur.css) to match current settings. Dynamic
 * (chrome.scripting) rather than a static manifest.json content_scripts
 * entry, since it now only applies in one of two configurable modes -- see
 * categories.ts's StartupDisplay doc comment. Still targets document_start,
 * so when active it blurs every image before first paint exactly like a
 * static entry would; the "visible" mode needs no equivalent registration
 * here since it has nothing to inject before first paint (content-script.ts
 * adds its own small stylesheet for the sensitive-image blur rule once it
 * runs, at document_idle -- no flash-of-content risk in that direction,
 * since starting visible is that mode's whole point).
 */
async function syncBlurCssRegistration(settings: ExtensionSettings): Promise<void> {
  const shouldRegister = settings.enabled && settings.startupDisplay === 'blurred'
  const existing = await chrome.scripting.getRegisteredContentScripts({
    ids: [BLUR_CSS_SCRIPT_ID],
  })
  const isRegistered = existing.length > 0

  if (shouldRegister && !isRegistered) {
    await chrome.scripting.registerContentScripts([
      {
        id: BLUR_CSS_SCRIPT_ID,
        matches: ['<all_urls>'],
        css: [BLUR_CSS_PATH],
        runAt: 'document_start',
      },
    ])
  } else if (!shouldRegister && isRegistered) {
    await chrome.scripting.unregisterContentScripts({ ids: [BLUR_CSS_SCRIPT_ID] })
  }
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
  void getSettings().then((settings) => {
    void saveSettings(settings) // heals any pre-existing settings missing newer fields
    void syncBlurCssRegistration(settings)
  })
  void warmUpIfEnabled()

  // Right-click action on any image, instead of a plain click on the image
  // itself — avoids triggering by accident on what might just be a normal
  // click (e.g. following a link). Chrome groups extension-added context
  // menu items into their own section near the bottom of the native menu
  // automatically; no positioning to configure on our end.
  //
  // A single toggle item rather than two fixed-effect items: the content
  // script (which owns the blur/reveal classes -- which one depends on the
  // current startupDisplay mode) is the one place that actually knows an
  // image's current blur state, so it can flip it directly — no need for
  // chrome.contextMenus.onShown (not available in the target Chrome
  // version) or for background to guess a target state.
  //
  // removeAll() first: onInstalled also fires on extension update, and
  // create() with a pre-existing id throws "duplicate id" otherwise.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: TOGGLE_MENU_ID,
      title: 'Calm Scroll - Toggle Image Blur',
      contexts: ['image'],
    })
  })
})

// onInstalled only fires on install/update, not on every browser launch --
// this is what actually warms the model up on a normal day-to-day session.
// Dynamic content script registrations (syncBlurCssRegistration) do persist
// across browser restarts on their own, but re-syncing here is cheap and
// defensive rather than assuming that always holds.
chrome.runtime.onStartup.addListener(() => {
  void warmUpIfEnabled()
  void getSettings().then((settings) => syncBlurCssRegistration(settings))
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== TOGGLE_MENU_ID || !tab?.id || !info.srcUrl) return
  // Caught, not left as an unhandled rejection: the content script won't be
  // there to receive this on a page the extension can't inject into (e.g.
  // chrome:// or a PDF viewer) or one that loaded before install/reload --
  // the image-only context menu item can technically still appear there.
  chrome.tabs
    .sendMessage(tab.id, { type: MessageType.ToggleImageBlur, imageUrl: info.srcUrl })
    .catch((err: unknown) => {
      console.warn('[calm-scroll/background] could not reach content script for toggle:', err)
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
      void syncBlurCssRegistration(message.settings)
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
