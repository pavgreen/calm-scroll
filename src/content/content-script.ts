import { MessageType, sendMessage, type ClassifyImageResponse } from '../shared/messaging'

/**
 * Content script.
 * TODO(dom-phase): replace the naive querySelectorAll scan with an
 * IntersectionObserver so only images entering the viewport are classified.
 * TODO(dom-phase): also scan CSS background-image and <picture>/<video poster>
 * sources, not just <img> elements.
 */

const BLUR_CLASS = 'calm-scroll-blur'
const CLASSIFY_TIMEOUT_MS = 15000

async function classifyImage(imageUrl: string): Promise<boolean> {
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
  }
}

function injectStyles(): void {
  const style = document.createElement('style')
  style.textContent = `.${BLUR_CLASS} { filter: blur(24px); transition: filter 0.15s ease; cursor: pointer; }
.${BLUR_CLASS}:hover { filter: blur(6px); }`
  document.documentElement.appendChild(style)
}

function applyBlurIfNeeded(img: HTMLImageElement): void {
  void classifyImage(img.src).then((isSensitive) => {
    if (isSensitive) {
      img.classList.add(BLUR_CLASS)
      img.addEventListener('click', () => img.classList.toggle(BLUR_CLASS))
    }
  })
}

function scanExistingImages(): void {
  document.querySelectorAll('img').forEach((img) => applyBlurIfNeeded(img))
}

function observeDom(): void {
  // TODO(dom-phase): swap for IntersectionObserver + MutationObserver combo.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLImageElement) {
          applyBlurIfNeeded(node)
        } else if (node instanceof HTMLElement) {
          node.querySelectorAll('img').forEach((img) => applyBlurIfNeeded(img))
        }
      })
    }
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
}

function init(): void {
  injectStyles()
  scanExistingImages()
  observeDom()
}

init()
