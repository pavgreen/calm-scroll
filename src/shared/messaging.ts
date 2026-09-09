import type { ExtensionSettings, PhobiaCategory } from './categories'

/**
 * Typed message contracts for content <-> background <-> offscreen <-> popup/options.
 */
export const MessageType = {
  ClassifyImageRequest: 'CLASSIFY_IMAGE_REQUEST',
  ClassifyImageResponse: 'CLASSIFY_IMAGE_RESPONSE',
  GetSettings: 'GET_SETTINGS',
  GetSettingsResponse: 'GET_SETTINGS_RESPONSE',
  SettingsUpdated: 'SETTINGS_UPDATED',
  OffscreenReady: 'OFFSCREEN_READY',
} as const

export type MessageType = (typeof MessageType)[keyof typeof MessageType]

export interface ClassifyImageRequest {
  type: typeof MessageType.ClassifyImageRequest
  requestId: string
  imageUrl: string
  /** Attached by background when forwarding this request to the offscreen document. */
  settings?: ExtensionSettings
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
  | ClassifyImageResponse
  | GetSettingsRequest
  | GetSettingsResponse
  | SettingsUpdatedMessage
  | OffscreenReadyMessage

export function sendMessage<TResponse = unknown>(message: ExtensionMessage): Promise<TResponse> {
  return chrome.runtime.sendMessage(message)
}
