import { test, expect } from './fixtures'
import { DEFAULT_SETTINGS } from '../../src/shared/categories'
import type { ClassifyImageResponse } from '../../src/shared/messaging'

/**
 * Validates real-world classification accuracy for every phobia category,
 * plus that clearly benign images never get flagged. Every reference image
 * below was individually verified against the real pipeline during
 * development before being committed here -- an image "should" match a
 * category isn't enough on its own; CLIP zero-shot scores don't always line
 * up with human intuition (e.g. the spiders/insects cross-match documented
 * in classification.spec.ts, discovered the same way).
 *
 * All images are hosted on Wikipedia/Wikimedia Commons -- the only sites
 * found, during this project's development, that tolerate automated
 * browser traffic. Google, Unsplash, Pexels, and Pixabay were all tried and
 * all block it: Google redirects to a /sorry/ interstitial (see
 * google-images.spec.ts), Unsplash serves an Anubis proof-of-work bot-check
 * placeholder instead of real photos, and Pexels/Pixabay render only a
 * favicon with no page content under this exact automated setup.
 *
 * Classifies directly against the offscreen pipeline
 * (OFFSCREEN_CLASSIFY_REQUEST, the same background->offscreen leg
 * background/index.ts itself uses) rather than through a full page
 * navigation: this suite is about model accuracy, not DOM/content-script
 * integration, which classification.spec.ts already covers.
 */

const POSITIVE_CASES: Record<string, string> = {
  spiders:
    'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Araneus_diadematus_%28Clerck%2C_1757%29.JPG/250px-Araneus_diadematus_%28Clerck%2C_1757%29.JPG',
  snakes:
    'https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Trimeresurus_sabahi_fucatus%2C_Banded_pit_viper_-_Takua_Pa_District%2C_Phang-nga_Province_%2846710893582%29.jpg/250px-Trimeresurus_sabahi_fucatus%2C_Banded_pit_viper_-_Takua_Pa_District%2C_Phang-nga_Province_%2846710893582%29.jpg',
  insects:
    'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/7-Spotted-Ladybug-Coccinella-septempunctata-sq1.jpg/250px-7-Spotted-Ladybug-Coccinella-septempunctata-sq1.jpg',
  blood_gore:
    'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Bleeding_finger.jpg/250px-Bleeding_finger.jpg',
  needles:
    'https://commons.wikimedia.org/wiki/Special:FilePath/Beveled_tip_of_a_hypodermic_needle_20090714_001.JPG',
  clowns:
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Auguste_clown_reading_a_book_upside-down.jpg/250px-Auguste_clown_reading_a_book_upside-down.jpg',
  dogs: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/Retriever_in_water.jpg/250px-Retriever_in_water.jpg',
}

// A food photo and two landscape photos -- clearly benign, no plausible
// reading under any of the 7 categories.
const NEUTRAL_CASES = [
  'https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Pizza-3007395.jpg/330px-Pizza-3007395.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Everest_North_Face_toward_Base_Camp_Tibet_Luca_Galuzzi_2006.jpg/330px-Everest_North_Face_toward_Base_Camp_Tibet_Luca_Galuzzi_2006.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7f/Ural_mountains_3_448122223_93fa978a6d_b.jpg/250px-Ural_mountains_3_448122223_93fa978a6d_b.jpg',
]

async function ensureOffscreenDocument(
  serviceWorker: import('@playwright/test').Worker,
): Promise<void> {
  await serviceWorker.evaluate(async () => {
    const OFFSCREEN_URL = 'src/offscreen/index.html'
    const existing = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
    })
    if (existing.length > 0) return
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'test',
    })
  })
}

/**
 * Classifies an image via the same background->offscreen message leg
 * background/index.ts uses (a cross-context send: this test code is
 * "sending as" the service worker, offscreen document is the recipient --
 * not the self-messaging pattern found unreliable in fixtures.ts's doc
 * comment). Retries the "Receiving end does not exist" race the same way
 * background/index.ts's own sendToOffscreenWithRetry does, in case
 * offscreen's listener hasn't finished registering yet.
 */
async function classifyDirect(
  serviceWorker: import('@playwright/test').Worker,
  imageUrl: string,
): Promise<ClassifyImageResponse> {
  await ensureOffscreenDocument(serviceWorker)

  const deadline = Date.now() + 15_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      return await serviceWorker.evaluate(
        async ({ url, settings }) =>
          chrome.runtime.sendMessage({
            type: 'OFFSCREEN_CLASSIFY_REQUEST',
            requestId: crypto.randomUUID(),
            imageUrl: url,
            settings,
          }),
        { url: imageUrl, settings: DEFAULT_SETTINGS },
      )
    } catch (err) {
      lastError = err
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  throw new Error(`classifyDirect never got a response: ${String(lastError)}`)
}

test.describe('classification accuracy across all phobia categories', () => {
  for (const [category, imageUrl] of Object.entries(POSITIVE_CASES)) {
    test(`${category}: a real reference image is classified as sensitive`, async ({
      serviceWorker,
    }) => {
      const response = await classifyDirect(serviceWorker, imageUrl)
      expect(response.error, `classification failed: ${response.error}`).toBeUndefined()
      expect(
        response.matchedCategories,
        `expected "${category}" among matched categories; got scores ${JSON.stringify(response.scores)}`,
      ).toContain(category)
    })
  }
})

test.describe('neutral/benign images are never filtered', () => {
  for (const imageUrl of NEUTRAL_CASES) {
    const label = decodeURIComponent(imageUrl.split('/').pop() ?? imageUrl)
    test(`${label}: stays unmatched at default settings`, async ({ serviceWorker }) => {
      const response = await classifyDirect(serviceWorker, imageUrl)
      expect(response.error, `classification failed: ${response.error}`).toBeUndefined()
      expect(
        response.isSensitive,
        `expected a benign image to NOT be sensitive; matched ${JSON.stringify(response.matchedCategories)}, scores ${JSON.stringify(response.scores)}`,
      ).toBe(false)
    })
  }
})
