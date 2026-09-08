import { MessageType } from '../shared/messaging'

/**
 * Offscreen document skeleton.
 * TODO(ml-phase): load transformers.js + the ONNX runtime WASM backend here
 * and run image classification off the main/service-worker thread.
 * This document is created on demand by the background service worker via
 * chrome.offscreen.createDocument({ url, reasons: ['WORKERS'], justification }).
 */

function notifyReady(): void {
  void chrome.runtime.sendMessage({ type: MessageType.OffscreenReady })
}

notifyReady()
