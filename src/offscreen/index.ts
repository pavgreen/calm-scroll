import {
  env,
  AutoProcessor,
  CLIPVisionModelWithProjection,
  RawImage,
} from '@huggingface/transformers'
import {
  MessageType,
  type ExtensionMessage,
  type ClassifyImageRequest,
  type ClassifyImageResponse,
} from '../shared/messaging'
import { PhobiaCategory } from '../shared/categories'
import { decide } from '../shared/similarity'
import categoryEmbeddings from '../shared/category-embeddings.generated.json'

/**
 * Offscreen document: hosts the on-device transformers.js vision model and
 * runs image classification off the service-worker thread. Created on
 * demand by the background service worker via chrome.offscreen.createDocument.
 *
 * Model files are vendored locally (see scripts/fetch-vision-model.mjs and
 * scripts/copy-onnxruntime-wasm.mjs) — allowRemoteModels is disabled so
 * transformers.js never attempts a network fetch at runtime.
 */

// Matches the public/models/mobileclip_s0/ layout — no org prefix for local files.
const MODEL_ID = 'mobileclip_s0'

env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = chrome.runtime.getURL('models/')
// env.backends.onnx.wasm is typed readonly + optional (Partial<onnxruntime-common
// Env>), but onnxruntime-common always populates it with a real, mutable
// object at runtime — only the top-level reference is readonly, not its
// own fields, so mutating wasmPaths on it is safe.
env.backends.onnx.wasm!.wasmPaths = chrome.runtime.getURL('ort/')
env.useBrowserCache = false
env.useWasmCache = false

let modelPromise: ReturnType<typeof loadModel> | null = null

function loadModel() {
  // dtype: fp32 — see scripts/fetch-vision-model.mjs for why (uint8
  // quantization was verified empirically to collapse this model's
  // discriminative signal almost entirely; fp32 restores correct behavior).
  return Promise.all([
    AutoProcessor.from_pretrained(MODEL_ID),
    CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'fp32' }),
  ])
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

async function handleClassify(
  imageUrl: string,
  settings: ClassifyImageRequest['settings'],
): Promise<Omit<ClassifyImageResponse, 'type' | 'requestId'>> {
  if (!settings) {
    return { isSensitive: false, scores: {}, matchedCategories: [], error: 'missing settings' }
  }
  try {
    modelPromise ??= loadModel()
    const [processor, model] = await modelPromise

    const image = await RawImage.fromURL(imageUrl)
    const inputs = await processor(image)
    const { image_embeds } = await model(inputs)
    const embedding: number[] = image_embeds.normalize().tolist()[0]

    const scores: Partial<Record<PhobiaCategory, number>> = {}
    for (const category of Object.values(PhobiaCategory)) {
      scores[category] = dotProduct(embedding, categoryEmbeddings.categories[category])
    }
    const neutralScore = dotProduct(embedding, categoryEmbeddings.neutral)

    const { isSensitive, matchedCategories } = decide(
      scores,
      neutralScore,
      settings.sensitivity,
      settings.categories,
    )
    return { isSensitive, scores, neutralScore, matchedCategories }
  } catch (err) {
    console.error('[calm-scroll/offscreen] classification failed:', err)
    // Fail-safe: matches content/index.ts's existing catch-block philosophy.
    return { isSensitive: false, scores: {}, matchedCategories: [], error: String(err) }
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type !== MessageType.ClassifyImageRequest) return false
  void handleClassify(message.imageUrl, message.settings).then((result) => {
    sendResponse({
      type: MessageType.ClassifyImageResponse,
      requestId: message.requestId,
      ...result,
    })
  })
  return true
})

void chrome.runtime.sendMessage({ type: MessageType.OffscreenReady })
