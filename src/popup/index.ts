import { MessageType, sendMessage, type GetSettingsResponse } from '../shared/messaging'
import { DEFAULT_SETTINGS } from '../shared/categories'

/**
 * Popup: quick on/off toggle for the whole extension. Per-category toggles,
 * sensitivity, and blur timing all live on the full options page instead
 * (the "More settings" link below) rather than being duplicated here.
 */

async function init(): Promise<void> {
  const toggle = document.querySelector<HTMLInputElement>('#enabled-toggle')
  const optionsLink = document.querySelector<HTMLAnchorElement>('#open-options')
  if (!toggle || !optionsLink) return

  const response = await sendMessage<GetSettingsResponse>({ type: MessageType.GetSettings })
  const settings = response?.settings ?? DEFAULT_SETTINGS
  toggle.checked = settings.enabled

  toggle.addEventListener('change', () => {
    void sendMessage({
      type: MessageType.SettingsUpdated,
      settings: { ...settings, enabled: toggle.checked },
    })
  })

  optionsLink.addEventListener('click', (event) => {
    event.preventDefault()
    chrome.runtime.openOptionsPage()
  })
}

void init()
