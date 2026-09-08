import { MessageType, sendMessage, type ClassifyImageResponse } from '../shared/messaging'

/**
 * Content script skeleton.
 * TODO(dom-phase): replace the naive querySelectorAll scan with an
 * IntersectionObserver so only images entering the viewport are classified.
 * TODO(dom-phase): also scan CSS background-image and <picture>/<video poster>
 * sources, not just <img> elements.
 * TODO(ml-phase): classifyImage() currently always resolves to "not sensitive".
 * Once the offscreen ML worker exists, this will route through background.
 */

const BLUR_CLASS = 'phobia-safe-browsing-blur'

async function classifyImage(imageUrl: string): Promise<boolean> {
  try {
    const response = await sendMessage<ClassifyImageResponse>({
      type: MessageType.ClassifyImageRequest,
      requestId: crypto.randomUUID(),
      imageUrl,
    })
    return response.isSensitive
  } catch {
    // TODO(ml-phase): surface classification errors once real inference exists.
    return false
  }
}

function applyBlurIfNeeded(img: HTMLImageElement): void {
  void classifyImage(img.src).then((isSensitive) => {
    if (isSensitive) {
      img.classList.add(BLUR_CLASS)
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
  scanExistingImages()
  observeDom()
}

init()
