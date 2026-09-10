import {
  MessageType,
  sendMessage,
  type ClassifyImageResponse,
  type ExtensionMessage,
  type GetSettingsResponse,
} from '../shared/messaging'
import { DEFAULT_SETTINGS, type StartupDisplay } from '../shared/categories'

/**
 * Content script.
 *
 * Image sources scanned: <img> (including ones inside <picture> -- the
 * browser always resolves those down to the inner <img>'s currentSrc,
 * which the existing <img> scan already reads, so no separate handling is
 * needed there) and <video poster> (see observeVideo() below). TODO(dom-phase):
 * CSS background-image is NOT scanned -- deliberately out of scope for now:
 * unlike <img>/<video poster>, there's no cheap way to enumerate candidate
 * elements without walking/observing computed styles broadly, and blurring
 * one cleanly (without also blurring any foreground text/content layered
 * over it) needs a synthetic overlay element, not just a CSS class on the
 * element itself -- a meaningfully bigger and riskier change than either of
 * the two sources above, given how much it'd touch on arbitrary third-party
 * page layouts.
 *
 * Blurring behavior depends on the current startupDisplay setting (see
 * categories.ts's doc comment) -- fetched once at init() and cached in
 * currentMode for the rest of this page's lifetime:
 * - 'blurred': every image starts blurred via a CSS default (public/content/
 *   blur.css, dynamically registered at document_start by background/
 *   index.ts -- the earliest possible point) before this script even runs,
 *   let alone before classification completes. This script's only job
 *   re: blurring is to add SAFE_CLASS once an image is actively confirmed
 *   safe, which overrides the CSS blur.
 * - 'visible' (default): images display normally; this script adds
 *   SENSITIVE_CLASS (styled by the small stylesheet injected below) once an
 *   image is actively confirmed sensitive.
 * Either way, classification itself fails CLOSED (see classifyImage's doc
 * comment) -- the mode only changes which state an image starts in and
 * which class gets added on a positive result, not the fail-safe direction.
 */

const SAFE_CLASS = 'calm-scroll-safe'
const SENSITIVE_CLASS = 'calm-scroll-sensitive'
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
// on a page would sit blurred (in 'blurred' mode) until this script gets
// around to them, for no safety benefit.
const MIN_CONTENT_DIMENSION_PX = 32

// Resolved once at init() from the current settings; defaults to
// DEFAULT_SETTINGS' mode in the unlikely event the toggle message listener
// below fires before init()'s settings fetch resolves.
let currentMode: StartupDisplay = DEFAULT_SETTINGS.startupDisplay

/**
 * Styling for the 'visible' mode's SENSITIVE_CLASS -- injected via JS
 * (rather than a document_start CSS file like 'blurred' mode's blur.css)
 * since there's no flash-of-content risk to guard against in this
 * direction: 'visible' mode's whole premise is that images start visible,
 * so it's fine for this rule to exist only once this script actually runs,
 * at document_idle. Mirrors blur.css's amounts for a consistent look
 * between modes.
 */
function injectSensitiveImageStyles(): void {
  const style = document.createElement('style')
  style.textContent = `
    img.${SENSITIVE_CLASS}, video.${SENSITIVE_CLASS} {
      filter: blur(24px) !important;
      transition: filter 0.15s ease;
      cursor: pointer;
    }
    img.${SENSITIVE_CLASS}:hover, video.${SENSITIVE_CLASS}:hover {
      filter: blur(6px) !important;
    }
  `
  document.documentElement.appendChild(style)
}

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
 * Resolves to whether an image is sensitive. Fails CLOSED: any
 * classification error or timeout resolves true (treat as sensitive)
 * rather than false — an inability to classify is not a confirmation of
 * safety, regardless of which startupDisplay mode is active.
 *
 * This covers TWO distinct failure shapes, both treated identically: a
 * transport-level failure (sendMessage rejects, or the timeout below wins
 * the race) is caught below; a response that arrives successfully but
 * carries an `error` field (background/offscreen caught something on their
 * end -- e.g. the image failed to decode -- and still answered rather than
 * leaving the request hanging) is checked explicitly, since blindly trusting
 * `response.isSensitive` there would silently fail OPEN instead: offscreen's
 * error responses set isSensitive: false as a neutral placeholder, not a
 * safety judgment -- see handleClassify's catch block in offscreen/index.ts.
 */
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
      if (response.error) {
        console.error('[calm-scroll/content] classification failed:', response.error)
        return true // fail closed, see doc comment above
      }
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

/**
 * Applies a completed classification result to an element -- shared by both
 * <img> and <video poster> (see applyBlurIfNeeded/applyBlurIfNeededForVideo
 * below), since the class-toggling logic itself doesn't depend on which.
 */
function applySensitivityResult(
  el: HTMLImageElement | HTMLVideoElement,
  isSensitive: boolean,
): void {
  if (currentMode === 'blurred') {
    if (!isSensitive) el.classList.add(SAFE_CLASS) // confirmed safe -> reveal
  } else if (isSensitive) {
    el.classList.add(SENSITIVE_CLASS) // confirmed sensitive -> blur
  }
}

function applyBlurIfNeeded(img: HTMLImageElement): void {
  const src = img.currentSrc || img.src
  if (!src) return
  void classifyImage(src).then((isSensitive) => applySensitivityResult(img, isSensitive))
}

/**
 * Classifies a <video>'s poster attribute -- the static thumbnail shown
 * before playback -- the same way an <img> is classified. Deliberately
 * scoped to just that: this extension only ever looks at the poster frame,
 * never the video content itself (out of scope -- see this file's header
 * comment), so a video's blur state reflects whether its poster looked
 * sensitive, not anything about what plays once it starts.
 */
function applyBlurIfNeededForVideo(video: HTMLVideoElement): void {
  const poster = video.poster
  if (!poster) return
  void classifyImage(poster).then((isSensitive) => applySensitivityResult(video, isSensitive))
}

// Only classify images/video posters once they're actually on/near screen,
// instead of every candidate element in the DOM up front — the real fix for
// large/lazy-loaded pages (image search results, infinite-scroll feeds),
// not just a concurrency band-aid. One shared observer for both element
// types: the dispatch-by-type happens in the callback, not via separate
// observer instances.
const observedMedia = new WeakSet<HTMLImageElement | HTMLVideoElement>()

const intersectionObserver = new IntersectionObserver(
  (entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const el = entry.target
      observer.unobserve(el)
      if (el instanceof HTMLImageElement) applyBlurIfNeeded(el)
      else if (el instanceof HTMLVideoElement) applyBlurIfNeededForVideo(el)
    }
  },
  { rootMargin: '200px' }, // start classifying just before an element scrolls into view
)

function observeImage(img: HTMLImageElement): void {
  if (observedMedia.has(img)) return
  observedMedia.add(img)
  if (isLikelyIcon(img)) {
    // In 'blurred' mode, icons need SAFE_CLASS to override the CSS
    // default's blur. In 'visible' mode there's nothing to do -- icons are
    // already visible, and SENSITIVE_CLASS is only ever added on a
    // confirmed-sensitive result, which icons never get since they're
    // never classified in the first place.
    if (currentMode === 'blurred') img.classList.add(SAFE_CLASS)
    return
  }
  intersectionObserver.observe(img)
}

function observeVideo(video: HTMLVideoElement): void {
  // No poster means no static frame to classify -- left alone entirely,
  // same as blur.css's video[poster] selector (which, being an attribute
  // selector, never applies to a poster-less <video> either). A poster
  // attribute added later via JS after this element was already scanned
  // without one is a known gap, not handled here -- same scope limitation
  // <img> already has for a src swapped in after the fact.
  if (!video.poster) return
  if (observedMedia.has(video)) return
  observedMedia.add(video)
  intersectionObserver.observe(video)
}

function scanExistingMedia(): void {
  document.querySelectorAll('img').forEach((img) => observeImage(img))
  document.querySelectorAll('video').forEach((video) => observeVideo(video))
}

function observeDom(): void {
  const mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLImageElement) {
          observeImage(node)
        } else if (node instanceof HTMLVideoElement) {
          observeVideo(node)
        } else if (node instanceof HTMLElement) {
          node.querySelectorAll('img').forEach((img) => observeImage(img))
          node.querySelectorAll('video').forEach((video) => observeVideo(video))
        }
      })
    }
  })
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true })
}

// Triggered by the right-click "Calm Scroll - Toggle Image Blur" context
// menu item (background/index.ts), not a plain click on the image — this
// message is background relaying that click, targeted at this one tab via
// chrome.tabs.sendMessage rather than a broadcast. Toggles whichever class
// is meaningful for the current mode -- SAFE_CLASS's presence means
// "revealed" in 'blurred' mode, SENSITIVE_CLASS's presence means "blurred"
// in 'visible' mode, so toggling the right one always produces the correct
// visual effect either way.
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type !== MessageType.ToggleImageBlur) return
  const toggleClass = currentMode === 'blurred' ? SAFE_CLASS : SENSITIVE_CLASS
  let matched = 0
  document.querySelectorAll('img').forEach((img) => {
    if (img.src === message.imageUrl || img.currentSrc === message.imageUrl) {
      matched++
      img.classList.toggle(toggleClass)
    }
  })
  if (matched === 0) {
    // Logged, not swallowed silently: if this ever fires, the URL Chrome
    // handed us via info.srcUrl didn't match any img.src/currentSrc in this
    // document (e.g. a src rewritten after the context menu opened), so the
    // click will visibly do nothing.
    console.warn('[calm-scroll/content] toggle-blur: no matching <img> for', message.imageUrl)
  }
})

async function init(): Promise<void> {
  injectSensitiveImageStyles()

  // Resolved before any scanning starts, so every image on this page is
  // handled under a single consistent mode -- not needed for correctness in
  // 'blurred' mode (its CSS default already applied at document_start,
  // before this script runs at all) but is needed in 'visible' mode, where
  // this is the only signal that an image should ever be blurred.
  try {
    const response = await sendMessage<GetSettingsResponse>({ type: MessageType.GetSettings })
    currentMode = response?.settings.startupDisplay ?? DEFAULT_SETTINGS.startupDisplay
  } catch (err) {
    console.error('[calm-scroll/content] failed to fetch settings, using default mode:', err)
  }

  scanExistingMedia()
  observeDom()
}

void init()
