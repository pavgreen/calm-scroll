import type { ExtensionSettings } from './categories'

/**
 * Typed message contracts for content <-> background <-> offscreen <-> popup/options.
 * TODO(ml-phase): extend ClassifyImageResponse with per-category scores once the
 * transformers.js model is wired up in the offscreen document.
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
}

export interface ClassifyImageResponse {
  type: typeof MessageType.ClassifyImageResponse
  requestId: string
  /** TODO(ml-phase): replace with real per-category confidence scores. */
  isSensitive: boolean
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
