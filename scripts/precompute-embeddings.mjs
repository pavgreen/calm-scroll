import { env, AutoTokenizer, CLIPTextModelWithProjection } from '@huggingface/transformers'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATEGORY_PROMPT_TEMPLATES, NEUTRAL_ANCHOR_PROMPTS } from '../src/shared/prompts.mjs'

// Manual, one-time, network-using dev script: runs the CLIP TEXT encoder
// (never shipped at runtime — only its output vectors are committed) against
// every category's prompt templates plus the neutral anchor prompts,
// mean-pools + re-normalizes per group, and writes the resulting vectors as
// a small committed JSON asset consumed directly by the offscreen document
// at runtime. Run manually, then commit the output; NOT part of
// `npm install`/`npm run build`.
//
// dtype: fp32 — this text encoder never ships in the extension bundle (only
// its precomputed output does), so there's no size/runtime cost to using
// full precision here, and doing so avoids compounding the accuracy loss
// uint8 quantization causes for this model (see fetch-vision-model.mjs for
// the empirical finding on the vision side; the text side wasn't separately
// isolated, but there's no reason to risk it when it's free to avoid).
const MODEL_ID = 'Xenova/mobileclip_s0'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

env.allowRemoteModels = true
env.allowLocalModels = false
env.cacheDir = join(root, '.transformers-cache')

const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID)
const textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'fp32' })

function meanNormalize(vectors) {
  const dim = vectors[0].length
  const out = new Array(dim).fill(0)
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) out[i] += v[i] / vectors.length
  }
  const norm = Math.sqrt(out.reduce((s, x) => s + x * x, 0))
  return out.map((x) => x / norm)
}

async function embed(prompts) {
  const inputs = tokenizer(prompts, { padding: 'max_length', truncation: true })
  const { text_embeds } = await textModel(inputs)
  return text_embeds.normalize().tolist()
}

const categories = {}
let dim = null
for (const [category, prompts] of Object.entries(CATEGORY_PROMPT_TEMPLATES)) {
  const vectors = await embed(prompts)
  dim ??= vectors[0].length
  categories[category] = meanNormalize(vectors)
}
const neutral = meanNormalize(await embed(NEUTRAL_ANCHOR_PROMPTS))

writeFileSync(
  join(root, 'src', 'shared', 'category-embeddings.generated.json'),
  JSON.stringify({
    modelId: MODEL_ID,
    dim,
    generatedAt: new Date().toISOString(),
    categories,
    neutral,
  }),
)

console.log(
  `Wrote embeddings (dim=${dim}) for ${Object.keys(categories).length} categories + neutral anchor.`,
)
