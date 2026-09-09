/**
 * Zero-shot text prompts per phobia category, used only at BUILD TIME by
 * scripts/precompute-embeddings.mjs to generate category-embeddings.generated.json.
 * Multiple templates per category are embedded separately and mean-pooled
 * (then re-normalized) to reduce prompt-wording sensitivity — standard CLIP
 * "prompt ensembling" practice.
 *
 * Plain JS + JSDoc (no TypeScript syntax) so this file can be imported
 * directly by both categories.ts and the Node precompute script without
 * needing a TS-execution tool.
 *
 * @typedef {'spiders'|'snakes'|'insects'|'blood_gore'|'needles'|'clowns'|'dogs'} PhobiaCategoryId
 */

/** @type {Record<PhobiaCategoryId, string[]>} */
export const CATEGORY_PROMPT_TEMPLATES = {
  spiders: ['a photo of a spider', 'a close-up of a spider', 'a tarantula crawling'],
  snakes: ['a photo of a snake', 'a close-up of a snake', 'a snake coiled or slithering'],
  insects: [
    'a photo of an insect',
    'a swarm of insects or bugs',
    'a close-up of a cockroach or beetle',
  ],
  blood_gore: [
    'a graphic photo of blood',
    'a bloody or gory injury',
    'a photo of graphic violence or gore',
  ],
  needles: ['a photo of a hypodermic needle or syringe', 'a medical injection with a needle'],
  clowns: ['a photo of a clown', 'a person in clown makeup and costume'],
  dogs: ['a photo of a dog', 'a dog barking or growling'],
}

/**
 * Generic/benign "neutral" anchor prompts included as additional zero-shot
 * candidates alongside the phobia categories. CLIP zero-shot scores are only
 * meaningful relative to the other candidates in the comparison set — without
 * a neutral anchor, a benign photo still gets forced to rank all category
 * prompts and the highest-scoring one could clear a fixed threshold even at
 * low absolute similarity. The neutral anchor gives "this image matches none
 * of the phobia categories" a fair chance to win, and also serves as a
 * per-image confidence floor.
 *
 * @type {string[]}
 */
export const NEUTRAL_ANCHOR_PROMPTS = [
  'a photo',
  'a photo of a person',
  'a photo of a landscape',
  'a photo of food',
  'a screenshot of text or a webpage',
  'a photo of an everyday object',
]
