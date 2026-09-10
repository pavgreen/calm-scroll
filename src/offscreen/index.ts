import {
  env,
  AutoProcessor,
  CLIPVisionModelWithProjection,
  RawImage,
} from '@huggingface/transformers'
import {
  MessageType,
  type ExtensionMessage,
  type OffscreenClassifyRequest,
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

function loadModel() {
  // dtype: fp32 — see scripts/fetch-vision-model.mjs for why (uint8
  // quantization was verified empirically to collapse this model's
  // discriminative signal almost entirely; fp32 restores correct behavior).
  return Promise.all([
    AutoProcessor.from_pretrained(MODEL_ID),
    CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'fp32' }),
  ])
}

// Starts loading immediately when this document is created (background
// creates it eagerly on install/browser-startup — see warmUpIfEnabled in
// background/index.ts) rather than lazily on the first classify request,
// so the ~45MB model + WASM runtime cold-load overlaps with normal
// browser/page-load activity instead of blocking a user's first image.
const modelPromise = loadModel()
// Loading eagerly (above) means nothing awaits this promise until a
// classify request actually arrives, which could be well after it settles
// -- if it rejects in the meantime, this keeps that from surfacing as a
// spurious "unhandled rejection" console warning. handleClassify's own
// `await modelPromise` below still sees and handles the real rejection via
// its try/catch when a request does come in.
modelPromise.catch(() => {})

function dotProduct(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

/**
 * Content-types RawImage.fromBlob() (createImageBitmap() under the hood)
 * can't reliably rasterize in this offscreen-document context — confirmed
 * empirically: it throws "InvalidStateError: The source image could not be
 * decoded" for at least some real-world SVGs (e.g. Wikipedia's own tagline
 * logo, encountered in production). Rather than let that surface as a
 * classification failure, these are skipped before ever attempting a
 * decode — see the 'skip' return path in fetchImage() below. SVGs are
 * vector graphics (icons, logos, diagrams), essentially never photographic
 * phobia-trigger content, so treating them as unconditionally safe is a
 * deliberate, low-risk exemption (same spirit as content-script.ts's
 * small-icon size exemption) rather than a fail-open loophole.
 */
const UNSUPPORTED_DECODE_CONTENT_TYPES = ['image/svg+xml']

/**
 * Fetches and decodes an image manually (instead of RawImage.fromURL, which
 * does the same thing internally but swallows the response's status/headers
 * before decode failures). Doing this ourselves surfaces exactly what came
 * back over the wire when createImageBitmap() rejects with "could not be
 * decoded" — e.g. a non-200 status, an unexpected content-type (an HTML
 * block/interstitial page instead of image bytes), or a suspiciously small
 * body — which is otherwise indistinguishable from a genuine decode failure.
 *
 * Returns the literal 'skip' (not an error) for known-unsupported content
 * types — see UNSUPPORTED_DECODE_CONTENT_TYPES above.
 */
async function fetchImage(imageUrl: string): Promise<RawImage | 'skip'> {
  const response = await fetch(imageUrl)
  const contentType = response.headers.get('content-type')
  const blob = await response.blob()
  if (contentType && UNSUPPORTED_DECODE_CONTENT_TYPES.some((t) => contentType.startsWith(t))) {
    return 'skip'
  }
  if (!response.ok || !contentType?.startsWith('image/')) {
    console.error(
      `[calm-scroll/offscreen] unexpected response for image fetch: status=${response.status} content-type=${contentType} size=${blob.size}B url=${imageUrl}`,
    )
  }
  try {
    return await RawImage.fromBlob(blob)
  } catch (err) {
    console.error(
      `[calm-scroll/offscreen] decode failed: status=${response.status} content-type=${contentType} size=${blob.size}B url=${imageUrl}`,
    )
    throw err
  }
}

async function handleClassify(
  imageUrl: string,
  settings: OffscreenClassifyRequest['settings'],
): Promise<Omit<ClassifyImageResponse, 'type' | 'requestId'>> {
  try {
    const [processor, model] = await modelPromise

    const image = await fetchImage(imageUrl)
    if (image === 'skip') {
      // Deliberate exemption, not a failure -- no `error` field, so
      // content-script.ts's fail-closed check (see its classifyImage() doc
      // comment) doesn't treat this as an inability to classify.
      return { isSensitive: false, scores: {}, matchedCategories: [] }
    }
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
    // isSensitive is set to false here as a neutral placeholder, NOT a
    // safety judgment -- the presence of `error` is what actually matters.
    // content-script.ts's classifyImage() checks for `error` and fails
    // CLOSED (treats as sensitive) whenever it's set, regardless of this
    // isSensitive value; this response shape exists so background.ts's own
    // catch block (a distinct failure path -- e.g. ensureOffscreenDocument
    // throwing) can reuse it without duplicating the fail-closed decision
    // in two places.
    return { isSensitive: false, scores: {}, matchedCategories: [], error: String(err) }
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  // OffscreenClassifyRequest (background -> offscreen) is a distinct type
  // from ClassifyImageRequest (content -> background) specifically so this
  // listener never sees the latter — chrome.runtime.sendMessage broadcasts
  // to every onMessage listener in the extension, so without that
  // separation this listener would also see content script's original
  // request directly, racing background's own handling of it.
  if (message.type !== MessageType.OffscreenClassifyRequest) return false
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
