import type { ExtensionSettings, PhobiaCategory } from './categories'

/**
 * Typed message contracts for content <-> background <-> offscreen <-> popup/options.
 */
export const MessageType = {
  ClassifyImageRequest: 'CLASSIFY_IMAGE_REQUEST',
  OffscreenClassifyRequest: 'OFFSCREEN_CLASSIFY_REQUEST',
  ClassifyImageResponse: 'CLASSIFY_IMAGE_RESPONSE',
  GetSettings: 'GET_SETTINGS',
  GetSettingsResponse: 'GET_SETTINGS_RESPONSE',
  SettingsUpdated: 'SETTINGS_UPDATED',
  OffscreenReady: 'OFFSCREEN_READY',
  ToggleImageBlur: 'TOGGLE_IMAGE_BLUR',
} as const

export type MessageType = (typeof MessageType)[keyof typeof MessageType]

/**
 * Content script -> background. Distinct from OffscreenClassifyRequest below
 * even though the payloads mostly overlap: chrome.runtime.sendMessage
 * broadcasts to every onMessage listener in the extension, not just an
 * intended recipient, so background and the offscreen document (which each
 * register their own listener) would otherwise both see the SAME message
 * and race to answer it. Distinct types make each leg unambiguous by
 * construction instead of relying on payload shape (e.g. "has settings").
 */
export interface ClassifyImageRequest {
  type: typeof MessageType.ClassifyImageRequest
  requestId: string
  imageUrl: string
}

/** Background -> offscreen document (see ClassifyImageRequest's doc comment). */
export interface OffscreenClassifyRequest {
  type: typeof MessageType.OffscreenClassifyRequest
  requestId: string
  imageUrl: string
  settings: ExtensionSettings
}

export interface ClassifyImageResponse {
  type: typeof MessageType.ClassifyImageResponse
  requestId: string
  isSensitive: boolean
  /** Cosine-similarity score per category actually evaluated. */
  scores: Partial<Record<PhobiaCategory, number>>
  /** Cosine-similarity score against the neutral/benign anchor — useful for calibration. */
  neutralScore?: number
  /** Categories that beat the neutral anchor, cleared the sensitivity threshold, and are enabled. */
  matchedCategories: PhobiaCategory[]
  /** Present when classification failed (image load/model error) — isSensitive is safely false in that case. */
  error?: string
}

export interface GetSettingsRequest {
  type: typeof MessageType.GetSettings
}

export interface GetSettingsResponse {
  type: typeof MessageType.GetSettingsResponse
  settings: ExtensionSettings
}

export interface SettingsUpdatedMessage {
  type: typeof MessageType.SettingsUpdated
  settings: ExtensionSettings
}

export interface OffscreenReadyMessage {
  type: typeof MessageType.OffscreenReady
}

/**
 * Background -> content script, in response to the right-click "Calm Scroll
 * - Toggle Image Blur" context menu item. Sent via chrome.tabs.sendMessage
 * (targeted at one tab), not the broadcast-everywhere
 * chrome.runtime.sendMessage used elsewhere in this file — there's only
 * ever one intended recipient here, so the broadcast-collision class of bug
 * (see ClassifyImageRequest's doc comment) doesn't apply.
 *
 * A true toggle, not a set-to-specific-state message: the content script is
 * the one place that actually knows an image's current blur state (via
 * SAFE_CLASS), so it flips it directly rather than background trying to
 * compute a target state blind. This also sidesteps needing
 * chrome.contextMenus.onShown, which isn't available in the target Chrome
 * version.
 */
export interface ToggleImageBlurMessage {
  type: typeof MessageType.ToggleImageBlur
  imageUrl: string
}

export type ExtensionMessage =
  | ClassifyImageRequest
  | OffscreenClassifyRequest
  | ClassifyImageResponse
  | GetSettingsRequest
  | GetSettingsResponse
  | SettingsUpdatedMessage
  | OffscreenReadyMessage
  | ToggleImageBlurMessage

export function sendMessage<TResponse = unknown>(message: ExtensionMessage): Promise<TResponse> {
  return chrome.runtime.sendMessage(message)
}
