import { MessageType, sendMessage, type ClassifyImageResponse } from '../shared/messaging'

/**
 * Content script.
 * TODO(dom-phase): also scan CSS background-image and <picture>/<video poster>
 * sources, not just <img> elements.
 */

const BLUR_CLASS = 'calm-scroll-blur'
const CLASSIFY_TIMEOUT_MS = 20000
// Only one offscreen document/model instance backs every tab's requests, so
// bound how many classify calls are in flight at once — without this, a
// page with hundreds of images (e.g. an image search results page) queues
// them all simultaneously and late ones blow past the timeout waiting on
// the single inference pipeline.
const MAX_CONCURRENT_CLASSIFICATIONS = 4

// Caches in-flight/completed classifications by URL so repeated <img> tags
// pointing at the same asset (common for icons, avatars, tracking pixels)
// are only classified once.
const classificationCache = new Map<string, Promise<boolean>>()

let activeCount = 0
const waiters: Array<() => void> = []

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT_CLASSIFICATIONS) {
    activeCount++
    return Promise.resolve()
  }
  return new Promise((resolve) => waiters.push(resolve))
}

function releaseSlot(): void {
  const next = waiters.shift()
  if (next) {
    next() // hand the slot directly to the next queued caller
  } else {
    activeCount--
  }
}

async function classifyImage(imageUrl: string): Promise<boolean> {
  const cached = classificationCache.get(imageUrl)
  if (cached) return cached

  const promise = (async () => {
    await acquireSlot()
    try {
      const timeout = new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error(`classify request timed out after ${CLASSIFY_TIMEOUT_MS}ms`)),
          CLASSIFY_TIMEOUT_MS,
        ),
      )
      const response = await Promise.race([
        sendMessage<ClassifyImageResponse>({
          type: MessageType.ClassifyImageRequest,
          requestId: crypto.randomUUID(),
          imageUrl,
        }),
        timeout,
      ])
      return response.isSensitive
    } catch (err) {
      // Fail safe: treat classification errors (offscreen/model failures,
      // messaging errors, timeouts) as "not sensitive" rather than blocking
      // the page — but still log, so failures are visible during development.
      console.error('[calm-scroll/content] classification failed:', err)
      return false
    } finally {
      releaseSlot()
    }
  })()

  classificationCache.set(imageUrl, promise)
  return promise
}

function injectStyles(): void {
  const style = document.createElement('style')
  style.textContent = `.${BLUR_CLASS} { filter: blur(24px); transition: filter 0.15s ease; cursor: pointer; }
.${BLUR_CLASS}:hover { filter: blur(6px); }`
  document.documentElement.appendChild(style)
}

function applyBlurIfNeeded(img: HTMLImageElement): void {
  const src = img.currentSrc || img.src
  if (!src) return
  void classifyImage(src).then((isSensitive) => {
    if (isSensitive) {
      img.classList.add(BLUR_CLASS)
      img.addEventListener('click', () => img.classList.toggle(BLUR_CLASS))
    }
  })
}

// Only classify images once they're actually on/near screen, instead of
// every <img> in the DOM up front — the real fix for large/lazy-loaded
// pages (image search results, infinite-scroll feeds), not just a
// concurrency band-aid.
const observedImages = new WeakSet<HTMLImageElement>()

const intersectionObserver = new IntersectionObserver(
  (entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const img = entry.target as HTMLImageElement
      observer.unobserve(img)
      applyBlurIfNeeded(img)
    }
  },
  { rootMargin: '200px' }, // start classifying just before an image scrolls into view
)

function observeImage(img: HTMLImageElement): void {
  if (observedImages.has(img)) return
  observedImages.add(img)
  intersectionObserver.observe(img)
}

function scanExistingImages(): void {
  document.querySelectorAll('img').forEach((img) => observeImage(img))
}

function observeDom(): void {
  const mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLImageElement) {
          observeImage(node)
        } else if (node instanceof HTMLElement) {
          node.querySelectorAll('img').forEach((img) => observeImage(img))
        }
      })
    }
  })
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true })
}

function init(): void {
  injectStyles()
  scanExistingImages()
  observeDom()
}

init()
