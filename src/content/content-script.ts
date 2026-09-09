import {
  MessageType,
  sendMessage,
  type ClassifyImageResponse,
  type ExtensionMessage,
} from '../shared/messaging'

/**
 * Content script.
 * TODO(dom-phase): also scan CSS background-image and <picture>/<video poster>
 * sources, not just <img> elements.
 *
 * Blurring itself is NOT done here — it's a CSS default (blur.css, injected
 * at document_start, the earliest possible point) so every image starts
 * blurred before this script even runs, let alone before classification
 * completes. This script's only job re: blurring is to add SAFE_CLASS once
 * an image is actively confirmed safe, which overrides the CSS blur.
 */

const SAFE_CLASS = 'calm-scroll-safe'
const CLASSIFY_TIMEOUT_MS = 20000
// Only one offscreen document/model instance backs every tab's requests, so
// bound how many classify calls are in flight at once — without this, a
// page with hundreds of images (e.g. an image search results page) queues
// them all simultaneously and late ones blow past the timeout waiting on
// the single inference pipeline.
const MAX_CONCURRENT_CLASSIFICATIONS = 4
// Images at or below this size in either dimension are treated as icons/UI
// chrome (nav buttons, logos, badges) rather than content, and are marked
// safe immediately without classification — otherwise every nav icon/logo
// on a page would sit blurred (via blur.css's default) until this script
// gets around to them, for no safety benefit.
const MIN_CONTENT_DIMENSION_PX = 32

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

/**
 * Resolves to whether an image should stay blurred. Fails CLOSED: any
 * classification error or timeout resolves true (stay blurred) rather than
 * false — images are blurred by default (see blur.css) until actively
 * confirmed safe, and an inability to classify is not a confirmation of safety.
 */
async function shouldStayBlurred(imageUrl: string): Promise<boolean> {
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
      // Logged, not swallowed silently, so failures stay visible during
      // development — but still resolves true (fail closed, see doc comment above).
      console.error('[calm-scroll/content] classification failed:', err)
      return true
    } finally {
      releaseSlot()
    }
  })()

  classificationCache.set(imageUrl, promise)
  return promise
}

function isLikelyIcon(img: HTMLImageElement): boolean {
  const width = img.width || img.naturalWidth
  const height = img.height || img.naturalHeight
  return (
    width > 0 &&
    width <= MIN_CONTENT_DIMENSION_PX &&
    height > 0 &&
    height <= MIN_CONTENT_DIMENSION_PX
  )
}

function applyBlurIfNeeded(img: HTMLImageElement): void {
  const src = img.currentSrc || img.src
  if (!src) return
  void shouldStayBlurred(src).then((staysBlurred) => {
    if (!staysBlurred) {
      img.classList.add(SAFE_CLASS) // confirmed safe -> reveal
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
  if (isLikelyIcon(img)) {
    img.classList.add(SAFE_CLASS)
    return
  }
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

// Set (not toggle) via the right-click "CalmScroll - Blur Image" /
// "CalmScroll - Display Image" context menu items (background/index.ts),
// not a plain click on the image — this message is background relaying
// that click, targeted at this one tab via chrome.tabs.sendMessage rather
// than a broadcast.
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type !== MessageType.SetImageBlur) return
  document.querySelectorAll('img').forEach((img) => {
    if (img.src === message.imageUrl || img.currentSrc === message.imageUrl) {
      img.classList.toggle(SAFE_CLASS, !message.blurred)
    }
  })
})

function init(): void {
  scanExistingImages()
  observeDom()
}

init()
