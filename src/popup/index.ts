import { MessageType, sendMessage, type GetSettingsResponse } from '../shared/messaging'
import { DEFAULT_SETTINGS } from '../shared/categories'

/**
 * Popup skeleton: quick on/off toggle for the whole extension.
 * TODO(settings-phase): reflect per-category toggles here too, or link out
 * to the full options page for that (current plan: link out).
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
