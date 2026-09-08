import { MessageType, sendMessage, type GetSettingsResponse } from '../shared/messaging'
import {
  DEFAULT_SETTINGS,
  PHOBIA_CATEGORIES,
  type ExtensionSettings,
  type Sensitivity,
} from '../shared/categories'

/**
 * Options page skeleton: category toggles, sensitivity, allow/deny lists.
 * TODO(settings-phase): wire allow/deny list add/remove UI (structure only
 * for now — see #allow-list / #deny-list containers in index.html).
 */

let currentSettings: ExtensionSettings = DEFAULT_SETTINGS

function renderCategories(container: HTMLElement, settings: ExtensionSettings): void {
  container.innerHTML = ''
  for (const category of PHOBIA_CATEGORIES) {
    const label = document.createElement('label')
    label.className = 'row'

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = settings.categories[category.id]
    checkbox.addEventListener('change', () => {
      void persistSettings({
        ...currentSettings,
        categories: { ...currentSettings.categories, [category.id]: checkbox.checked },
      })
    })

    const span = document.createElement('span')
    span.textContent = category.label

    label.append(span, checkbox)
    container.append(label)
  }
}

async function persistSettings(settings: ExtensionSettings): Promise<void> {
  currentSettings = settings
  await sendMessage({ type: MessageType.SettingsUpdated, settings })
}

async function init(): Promise<void> {
  const categoriesContainer = document.querySelector<HTMLElement>('#categories')
  const sensitivitySelect = document.querySelector<HTMLSelectElement>('#sensitivity')
  if (!categoriesContainer || !sensitivitySelect) return

  const response = await sendMessage<GetSettingsResponse>({ type: MessageType.GetSettings })
  currentSettings = response?.settings ?? DEFAULT_SETTINGS

  renderCategories(categoriesContainer, currentSettings)
  sensitivitySelect.value = currentSettings.sensitivity
  sensitivitySelect.addEventListener('change', () => {
    void persistSettings({
      ...currentSettings,
      sensitivity: sensitivitySelect.value as Sensitivity,
    })
  })

  // TODO(settings-phase): render currentSettings.allowList / denyList here.
}

void init()
