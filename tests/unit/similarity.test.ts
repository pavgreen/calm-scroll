import { describe, it, expect } from 'vitest'
import { decide, SIMILARITY_THRESHOLD } from '../../src/shared/similarity'
import {
  PhobiaCategory,
  DEFAULT_SETTINGS,
  type CategorySettings,
} from '../../src/shared/categories'

/** All categories enabled — the default settings shape. */
const ALL_ENABLED: CategorySettings = DEFAULT_SETTINGS.categories

function withDisabled(...categories: PhobiaCategory[]): CategorySettings {
  const settings = { ...ALL_ENABLED }
  for (const category of categories) settings[category] = false
  return settings
}

describe('decide', () => {
  it('matches a category that clears the threshold and beats the neutral anchor', () => {
    const result = decide(
      { [PhobiaCategory.Spiders]: 0.28 },
      /* neutralScore */ 0.14,
      'medium',
      ALL_ENABLED,
    )
    expect(result.isSensitive).toBe(true)
    expect(result.matchedCategories).toEqual([PhobiaCategory.Spiders])
  })

  it('does not match a score below the neutral anchor, even above the raw threshold', () => {
    // Mirrors the real uint8-quantization bug this was calibrated against:
    // every category scoring below neutral must never count as a match.
    const result = decide(
      { [PhobiaCategory.Spiders]: 0.2 },
      /* neutralScore */ 0.25,
      'high', // lowest threshold (0.13) -- 0.2 clears it, but neutral wins
      ALL_ENABLED,
    )
    expect(result.isSensitive).toBe(false)
    expect(result.matchedCategories).toEqual([])
  })

  it('does not match a score that beats neutral but falls below the threshold', () => {
    const result = decide(
      { [PhobiaCategory.Spiders]: 0.15 },
      /* neutralScore */ 0.1,
      'low', // threshold 0.22 -- 0.15 doesn't clear it
      ALL_ENABLED,
    )
    expect(result.isSensitive).toBe(false)
    expect(result.matchedCategories).toEqual([])
  })

  it('requires a score to strictly exceed neutral, not just tie it', () => {
    const result = decide({ [PhobiaCategory.Spiders]: 0.3 }, 0.3, 'high', ALL_ENABLED)
    expect(result.matchedCategories).toEqual([])
  })

  describe('sensitivity thresholds', () => {
    // A score that clears 'high' and 'medium' but not 'low'.
    const score = 0.2
    const neutral = 0.05

    it('matches at high sensitivity', () => {
      expect(
        decide({ [PhobiaCategory.Dogs]: score }, neutral, 'high', ALL_ENABLED).isSensitive,
      ).toBe(true)
    })

    it('matches at medium sensitivity', () => {
      expect(
        decide({ [PhobiaCategory.Dogs]: score }, neutral, 'medium', ALL_ENABLED).isSensitive,
      ).toBe(true)
    })

    it('does not match at low sensitivity', () => {
      expect(
        decide({ [PhobiaCategory.Dogs]: score }, neutral, 'low', ALL_ENABLED).isSensitive,
      ).toBe(false)
    })

    it('thresholds get strictly looser from low -> medium -> high', () => {
      expect(SIMILARITY_THRESHOLD.low).toBeGreaterThan(SIMILARITY_THRESHOLD.medium)
      expect(SIMILARITY_THRESHOLD.medium).toBeGreaterThan(SIMILARITY_THRESHOLD.high)
    })
  })

  describe('per-category enable/disable settings', () => {
    it('never matches a disabled category, regardless of score', () => {
      const result = decide(
        { [PhobiaCategory.Spiders]: 0.9 }, // score high enough to match at any sensitivity
        0.1,
        'high',
        withDisabled(PhobiaCategory.Spiders),
      )
      expect(result.isSensitive).toBe(false)
      expect(result.matchedCategories).toEqual([])
    })

    it('still matches other enabled categories when one is disabled', () => {
      const result = decide(
        { [PhobiaCategory.Spiders]: 0.9, [PhobiaCategory.Dogs]: 0.9 },
        0.1,
        'high',
        withDisabled(PhobiaCategory.Spiders),
      )
      expect(result.matchedCategories).toEqual([PhobiaCategory.Dogs])
    })

    it('matches nothing when every category is disabled', () => {
      const allDisabled = Object.fromEntries(
        Object.values(PhobiaCategory).map((c) => [c, false]),
      ) as CategorySettings
      const result = decide({ [PhobiaCategory.Spiders]: 0.9 }, 0.1, 'high', allDisabled)
      expect(result.isSensitive).toBe(false)
    })
  })

  it('matches multiple categories at once when several clear the bar', () => {
    const result = decide(
      {
        [PhobiaCategory.Spiders]: 0.28,
        [PhobiaCategory.Insects]: 0.25,
        [PhobiaCategory.Dogs]: 0.08,
      },
      0.14,
      'medium',
      ALL_ENABLED,
    )
    expect(result.matchedCategories.sort()).toEqual(
      [PhobiaCategory.Spiders, PhobiaCategory.Insects].sort(),
    )
  })

  it('isSensitive is exactly matchedCategories.length > 0', () => {
    const empty = decide({}, 0.1, 'medium', ALL_ENABLED)
    expect(empty.isSensitive).toBe(false)
    expect(empty.matchedCategories).toEqual([])
  })
})
