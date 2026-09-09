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

export type ExtensionMessage =
  | ClassifyImageRequest
  | OffscreenClassifyRequest
  | ClassifyImageResponse
  | GetSettingsRequest
  | GetSettingsResponse
  | SettingsUpdatedMessage
  | OffscreenReadyMessage

export function sendMessage<TResponse = unknown>(message: ExtensionMessage): Promise<TResponse> {
  return chrome.runtime.sendMessage(message)
}
