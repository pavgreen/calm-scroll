import { MessageType, sendMessage, type GetSettingsResponse } from '../shared/messaging'
import {
  DEFAULT_SETTINGS,
  PHOBIA_CATEGORIES,
  type ExtensionSettings,
  type Sensitivity,
  type StartupDisplay,
} from '../shared/categories'

const STARTUP_DISPLAY_DESCRIPTIONS: Record<StartupDisplay, string> = {
  visible: 'Images display normally; a sensitive one is blurred once it’s detected.',
  blurred: 'Every image is blurred immediately and revealed once confirmed safe.',
}

/**
 * Options page: category toggles, sensitivity, allow/deny lists.
 * TODO(settings-phase): wire allow/deny list add/remove UI (structure only
 * for now — see the allow-list/deny-list placeholders in index.html).
 */

let currentSettings: ExtensionSettings = DEFAULT_SETTINGS

function renderCategories(container: HTMLElement, settings: ExtensionSettings): void {
  container.innerHTML = ''
  for (const category of PHOBIA_CATEGORIES) {
    const row = document.createElement('div')
    row.className = 'category-row'

    const text = document.createElement('div')
    text.className = 'category-text'
    const label = document.createElement('span')
    label.className = 'category-label'
    label.textContent = category.label
    const description = document.createElement('span')
    description.className = 'category-description'
    description.textContent = category.description
    text.append(label, description)

    const toggle = document.createElement('label')
    toggle.className = 'toggle'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = settings.categories[category.id]
    checkbox.addEventListener('change', () => {
      void persistSettings({
        ...currentSettings,
        categories: { ...currentSettings.categories, [category.id]: checkbox.checked },
      })
    })
    const track = document.createElement('span')
    track.className = 'toggle-track'
    const thumb = document.createElement('span')
    thumb.className = 'toggle-thumb'
    track.append(thumb)
    toggle.append(checkbox, track)

    row.append(text, toggle)
    container.append(row)
  }
}

function renderSensitivity(container: HTMLElement, settings: ExtensionSettings): void {
  const inputs = container.querySelectorAll<HTMLInputElement>('input[name="sensitivity"]')
  inputs.forEach((input) => {
    input.checked = input.value === settings.sensitivity
    input.addEventListener('change', () => {
      if (!input.checked) return
      void persistSettings({
        ...currentSettings,
        sensitivity: input.value as Sensitivity,
      })
    })
  })
}

function renderStartupDisplay(container: HTMLElement, settings: ExtensionSettings): void {
  const description = document.querySelector<HTMLElement>('#startup-display-description')
  const inputs = container.querySelectorAll<HTMLInputElement>('input[name="startup-display"]')
  inputs.forEach((input) => {
    input.checked = input.value === settings.startupDisplay
    input.addEventListener('change', () => {
      if (!input.checked) return
      const startupDisplay = input.value as StartupDisplay
      if (description) description.textContent = STARTUP_DISPLAY_DESCRIPTIONS[startupDisplay]
      void persistSettings({ ...currentSettings, startupDisplay })
    })
  })
  if (description) description.textContent = STARTUP_DISPLAY_DESCRIPTIONS[settings.startupDisplay]
}

async function persistSettings(settings: ExtensionSettings): Promise<void> {
  currentSettings = settings
  await sendMessage({ type: MessageType.SettingsUpdated, settings })
}

async function init(): Promise<void> {
  const categoriesContainer = document.querySelector<HTMLElement>('#categories')
  const sensitivityContainer = document.querySelector<HTMLElement>('#sensitivity')
  const startupDisplayContainer = document.querySelector<HTMLElement>('#startup-display')
  if (!categoriesContainer || !sensitivityContainer || !startupDisplayContainer) return

  const response = await sendMessage<GetSettingsResponse>({ type: MessageType.GetSettings })
  currentSettings = response?.settings ?? DEFAULT_SETTINGS

  renderCategories(categoriesContainer, currentSettings)
  renderSensitivity(sensitivityContainer, currentSettings)
  renderStartupDisplay(startupDisplayContainer, currentSettings)

  // TODO(settings-phase): render currentSettings.allowList / denyList here.
}

void init()
