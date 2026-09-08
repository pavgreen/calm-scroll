/**
 * Canonical list of phobia categories the extension can detect and blur.
 * TODO(ml-phase): Each category will eventually map to one or more labels
 * produced by the on-device transformers.js image classification model.
 */
export enum PhobiaCategory {
  Spiders = 'spiders',
  Snakes = 'snakes',
  Insects = 'insects',
  Trypophobia = 'trypophobia',
  BloodGore = 'blood_gore',
  Needles = 'needles',
  Clowns = 'clowns',
  Dogs = 'dogs',
  Heights = 'heights',
}

export interface PhobiaCategoryInfo {
  id: PhobiaCategory
  label: string
  description: string
}

export const PHOBIA_CATEGORIES: readonly PhobiaCategoryInfo[] = [
  { id: PhobiaCategory.Spiders, label: 'Spiders', description: 'Arachnophobia triggers' },
  { id: PhobiaCategory.Snakes, label: 'Snakes', description: 'Ophidiophobia triggers' },
  { id: PhobiaCategory.Insects, label: 'Insects', description: 'Entomophobia triggers' },
  {
    id: PhobiaCategory.Trypophobia,
    label: 'Clustered holes/patterns',
    description: 'Trypophobia triggers',
  },
  {
    id: PhobiaCategory.BloodGore,
    label: 'Blood & gore',
    description: 'Hemophobia / graphic injury triggers',
  },
  { id: PhobiaCategory.Needles, label: 'Needles', description: 'Trypanophobia triggers' },
  { id: PhobiaCategory.Clowns, label: 'Clowns', description: 'Coulrophobia triggers' },
  { id: PhobiaCategory.Dogs, label: 'Dogs', description: 'Cynophobia triggers' },
  {
    id: PhobiaCategory.Heights,
    label: 'Heights',
    description: 'Acrophobia triggers (vertigo-inducing imagery)',
  },
]

export type CategorySettings = Record<PhobiaCategory, boolean>

export type Sensitivity = 'low' | 'medium' | 'high'

export interface SiteListEntry {
  hostname: string
}

export interface ExtensionSettings {
  enabled: boolean
  categories: CategorySettings
  sensitivity: Sensitivity
  allowList: SiteListEntry[]
  denyList: SiteListEntry[]
}

function defaultCategorySettings(): CategorySettings {
  const entries = PHOBIA_CATEGORIES.map((c) => [c.id, true] as const)
  return Object.fromEntries(entries) as CategorySettings
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  categories: defaultCategorySettings(),
  sensitivity: 'medium',
  allowList: [],
  denyList: [],
}
