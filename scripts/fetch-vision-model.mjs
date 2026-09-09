import { env, CLIPVisionModelWithProjection, AutoProcessor } from '@huggingface/transformers'
import { cpSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Manual, one-time, network-using dev script: downloads ONLY the vision
// tower of Xenova/mobileclip_s0 plus its tiny config/preprocessor JSON, and
// vendors them into public/ so they ship inside the built extension. The
// text encoder is never touched here (see precompute-embeddings.mjs).
//
// dtype: fp32 (NOT uint8) — verified empirically (see fp32-experiment.mjs
// in the dev scratch dir during this project's build-out) that uint8
// quantization collapses this specific model's discriminative signal
// almost entirely (every category scored below the neutral anchor for
// every test image, regardless of content). fp32 restores clear, correct
// separation (e.g. a real spider photo scores ~0.29 on "spiders" vs ~0.11
// on unrelated categories). fp16 was also tried and rejected: it fails to
// even load, tripping an ONNX Runtime graph-optimizer bug specific to this
// model's architecture ("SimplifiedLayerNormFusion" node lookup failure).
// This is also this model's own declared default (see config.json's
// transformers.js_config.dtype.vision_model), so passing it explicitly
// here is about being unambiguous, not overriding anything.
const MODEL_ID = 'Xenova/mobileclip_s0'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = join(root, '.transformers-cache')
const outDir = join(root, 'public', 'models', 'mobileclip_s0')

env.allowRemoteModels = true
env.allowLocalModels = false
env.cacheDir = cacheDir

await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'fp32' })
await AutoProcessor.from_pretrained(MODEL_ID)

/**
 * transformers.js's on-disk cache layout under a custom env.cacheDir isn't
 * guaranteed to match a hand-guessed path across versions, so discover the
 * actual model directory instead of hardcoding it.
 */
function findCachedModelDir(dir) {
  if (existsSync(join(dir, 'config.json')) && existsSync(join(dir, 'onnx'))) return dir
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const found = findCachedModelDir(join(dir, entry.name))
      if (found) return found
    }
  }
  return null
}

const cachedModelDir = findCachedModelDir(cacheDir)
if (!cachedModelDir) {
  throw new Error(
    `Could not locate downloaded model files under ${cacheDir} — inspect its contents manually.`,
  )
}

mkdirSync(join(outDir, 'onnx'), { recursive: true })
cpSync(join(cachedModelDir, 'config.json'), join(outDir, 'config.json'))
cpSync(join(cachedModelDir, 'preprocessor_config.json'), join(outDir, 'preprocessor_config.json'))
cpSync(join(cachedModelDir, 'onnx', 'vision_model.onnx'), join(outDir, 'onnx', 'vision_model.onnx'))

// LICENSE isn't part of from_pretrained's file set — fetch it separately and
// commit it verbatim per apple-amlr's redistribution/attribution terms.
const licenseRes = await fetch(`https://huggingface.co/${MODEL_ID}/raw/main/LICENSE`)
if (!licenseRes.ok) throw new Error(`Failed to fetch LICENSE: ${licenseRes.status}`)
writeFileSync(join(outDir, 'LICENSE'), await licenseRes.text())
writeFileSync(
  join(outDir, 'ATTRIBUTION.md'),
  `# Model attribution\n\n` +
    `Vision encoder weights vendored unmodified from https://huggingface.co/${MODEL_ID}\n` +
    `(Apple MobileCLIP-S0, ONNX port by the transformers.js community).\n` +
    `Licensed under Apple's AMLR license — see LICENSE in this directory.\n` +
    `Downloaded ${new Date().toISOString().slice(0, 10)}.\n`,
)

console.log(`Vendored vision encoder into ${outDir}`)
