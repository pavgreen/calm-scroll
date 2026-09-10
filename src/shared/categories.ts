import {
  CATEGORY_PROMPT_TEMPLATES as _CATEGORY_PROMPT_TEMPLATES,
  NEUTRAL_ANCHOR_PROMPTS,
} from './prompts.mjs'

/**
 * Canonical list of phobia categories the extension can detect and blur.
 * Zero-shot text prompts per category (used to precompute classification
 * embeddings) live in ./prompts.mjs — re-exported below, cast onto
 * PhobiaCategory since prompts.mjs is plain JS and only knows about the
 * category id strings, not the TS enum type.
 */
export enum PhobiaCategory {
  Spiders = 'spiders',
  Snakes = 'snakes',
  Insects = 'insects',
  BloodGore = 'blood_gore',
  Needles = 'needles',
  Clowns = 'clowns',
  Dogs = 'dogs',
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
    id: PhobiaCategory.BloodGore,
    label: 'Blood & gore',
    description: 'Hemophobia / graphic injury triggers',
  },
  { id: PhobiaCategory.Needles, label: 'Needles', description: 'Trypanophobia triggers' },
  { id: PhobiaCategory.Clowns, label: 'Clowns', description: 'Coulrophobia triggers' },
  { id: PhobiaCategory.Dogs, label: 'Dogs', description: 'Cynophobia triggers' },
]

export type CategorySettings = Record<PhobiaCategory, boolean>

export type Sensitivity = 'low' | 'medium' | 'high'

/**
 * Controls what an image looks like before classification finishes:
 * - 'visible' (default): images display normally; a sensitive one is
 *   blurred once classification confirms it. Never delays/hides a benign
 *   image, at the cost of a brief window where a genuinely sensitive image
 *   can be visible while its classification is still in flight.
 * - 'blurred': every image is blurred immediately (before classification
 *   even starts) and is only revealed once confirmed safe. No window where
 *   a sensitive image is visible, at the cost of every image -- including
 *   benign ones -- being briefly blurred on load.
 */
export type StartupDisplay = 'visible' | 'blurred'

export interface SiteListEntry {
  hostname: string
}

export interface ExtensionSettings {
  enabled: boolean
  categories: CategorySettings
  sensitivity: Sensitivity
  startupDisplay: StartupDisplay
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
  startupDisplay: 'visible',
  allowList: [],
  denyList: [],
}

export const CATEGORY_PROMPT_TEMPLATES = _CATEGORY_PROMPT_TEMPLATES as unknown as Record<
  PhobiaCategory,
  string[]
>
export { NEUTRAL_ANCHOR_PROMPTS }
