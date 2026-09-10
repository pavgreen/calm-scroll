import type { PhobiaCategory, CategorySettings, Sensitivity } from './categories'

/**
 * Cosine-similarity floor per sensitivity level, applied on top of the
 * neutral-anchor comparison (see decide() below).
 *
 * Calibrated against real classification runs through the full pipeline
 * (fp32 vision + text encoders — see loadModel()'s dtype comment in
 * offscreen/index.ts): a tarantula photo scored 0.28 on "spiders" (neutral
 * 0.14), a garden spider photo scored 0.28 on "spiders" (neutral 0.15), a
 * dog photo scored 0.21 on "dogs" (neutral 0.12) — genuine matches cluster
 * ~0.18-0.28 with a clear positive margin over neutral. Unrelated
 * categories on the same images, and every category on control images with
 * no phobia content (e.g. a logo), stayed at ~0.05-0.15, mostly below
 * neutral.
 *
 * tests/e2e/category-accuracy.spec.ts now confirms these thresholds work on
 * a real reference image for all 7 categories (plus 3 neutral images that
 * must stay unmatched), not just the 2 sampled above -- but that's still
 * one positive image per category, not a broad statistically meaningful
 * sample. TODO(tuning): revisit with multiple labeled images per category
 * (and near-miss/hard-negative examples, to validate specificity, not just
 * recall) before treating these numbers as anything more than "confirmed
 * not obviously wrong."
 */
export const SIMILARITY_THRESHOLD: Record<Sensitivity, number> = {
  low: 0.22,
  medium: 0.17,
  high: 0.13,
}

/**
 * Decides which (if any) phobia categories a classified image matches.
 *
 * CLIP zero-shot scores are only meaningful relative to other candidates, so
 * a category counts as a match only if it BOTH beats the neutral anchor's
 * score (prevents forcing every image into a phobia bucket just because one
 * category scored highest among several) AND clears an absolute threshold
 * for the current sensitivity level. Disabled categories (per user settings)
 * never match, regardless of score.
 *
 * Framework-free (no chrome.* references) so it's trivially testable.
 */
export function decide(
  scores: Partial<Record<PhobiaCategory, number>>,
  neutralScore: number,
  sensitivity: Sensitivity,
  enabledCategories: CategorySettings,
): { isSensitive: boolean; matchedCategories: PhobiaCategory[] } {
  const threshold = SIMILARITY_THRESHOLD[sensitivity]
  const matchedCategories = (Object.entries(scores) as [PhobiaCategory, number][])
    .filter(
      ([category, score]) =>
        enabledCategories[category] && score > neutralScore && score >= threshold,
    )
    .map(([category]) => category)
  return { isSensitive: matchedCategories.length > 0, matchedCategories }
}
