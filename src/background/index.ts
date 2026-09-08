import { MessageType, type ExtensionMessage } from '../shared/messaging'
import { DEFAULT_SETTINGS, type ExtensionSettings } from '../shared/categories'

/**
 * Background service worker: routes typed messages between content scripts,
 * the offscreen document, and popup/options pages, and owns settings storage.
 * TODO(ml-phase): forward CLASSIFY_IMAGE_REQUEST to the offscreen document
 * (creating it on demand via chrome.offscreen.createDocument) instead of
 * answering synchronously here.
 */

const SETTINGS_STORAGE_KEY = 'settings'

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

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  switch (message.type) {
    case MessageType.ClassifyImageRequest: {
      // TODO(ml-phase): route to offscreen document for real inference.
      sendResponse({
        type: MessageType.ClassifyImageResponse,
        requestId: message.requestId,
        isSensitive: false,
      })
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
      // TODO(ml-phase): mark offscreen worker as ready to receive classify jobs.
      return false
    }
    default: {
      return false
    }
  }
})
