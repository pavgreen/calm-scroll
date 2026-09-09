import { test, expect } from './fixtures'
import { DEFAULT_SETTINGS, type ExtensionSettings } from '../../src/shared/categories'

/**
 * Wikipedia's "Spider" article: the reference page used throughout this
 * project's development for real-world classification testing. Chosen for
 * this suite specifically because it's stable (encyclopedia content, not a
 * search results page) and known-good (see git history for the manual
 * verification this suite formalizes) -- a real garden-spider photo that
 * reliably classifies as "spiders" at default settings.
 */
const SPIDER_ARTICLE_URL = 'https://en.wikipedia.org/wiki/Spider'
const KNOWN_SPIDER_IMAGE_SELECTOR = 'img[src*="Araneus_diadematus"]'

/**
 * Writes settings directly to chrome.storage.local rather than through
 * SETTINGS_UPDATED (self-messaging from the service worker to its own
 * listener -- see fixtures.ts's waitForServiceWorkerReady doc comment for
 * why that's avoided in test setup code). background/index.ts's classify
 * handler reads settings from storage on every request regardless of how
 * they got there, so this exercises the same "responds to configured
 * settings" behavior without depending on the unreliable self-send path.
 */
async function updateSettings(
  serviceWorker: import('@playwright/test').Worker,
  settings: ExtensionSettings,
): Promise<void> {
  await serviceWorker.evaluate(async (s) => chrome.storage.local.set({ settings: s }), settings)
}

/**
 * Polls an image's computed filter, returning 'safe' as soon as it's
 * revealed, or 'blurred' if it's still blurred once the timeout elapses
 * (i.e. it either stayed sensitive/pending for the whole window, which is
 * exactly what the "should stay blurred" tests below want to confirm).
 */
async function waitForClassification(
  page: import('@playwright/test').Page,
  imgSelector: string,
  timeoutMs = 45_000,
): Promise<'blurred' | 'safe'> {
  const deadline = Date.now() + timeoutMs
  let filter = 'blur(24px)'
  while (Date.now() < deadline) {
    filter = await page
      .locator(imgSelector)
      .first()
      .evaluate((img) => getComputedStyle(img).filter)
    if (filter === 'none') return 'safe'
    await page.waitForTimeout(1000)
  }
  return filter === 'none' ? 'safe' : 'blurred'
}

test.describe('classification against a real reference page (Wikipedia Spider article)', () => {
  // Every test starts from a known settings baseline. Each test gets a
  // fresh extension context (see fixtures.ts), so this isn't strictly
  // needed for isolation -- it's here so tests stay correct even if that
  // ever changes, and so intent is explicit rather than implied by fixture
  // scoping.
  test.beforeEach(async ({ serviceWorker }) => {
    await updateSettings(serviceWorker, DEFAULT_SETTINGS)
  })

  test('a real spider photo is blurred and stays blurred at default settings', async ({ page }) => {
    await page.goto(SPIDER_ARTICLE_URL, { waitUntil: 'load' })
    await page.locator(KNOWN_SPIDER_IMAGE_SELECTOR).first().scrollIntoViewIfNeeded()

    const state = await waitForClassification(page, KNOWN_SPIDER_IMAGE_SELECTOR)
    expect(state, 'a real spider photo should be classified as sensitive and stay blurred').toBe(
      'blurred',
    )
  })

  test('non-photo UI chrome (small icons) is never left blurred', async ({ page }) => {
    await page.goto(SPIDER_ARTICLE_URL, { waitUntil: 'load' })
    // The Wikipedia wordmark is a small logo present on every article; it's
    // below the 32px icon-exclusion threshold in content-script.ts and
    // should be marked safe immediately, without ever going through
    // classification.
    const selector = 'img[src*="wikipedia-wordmark"]'
    await expect
      .poll(
        async () =>
          page
            .locator(selector)
            .first()
            .evaluate((img) => getComputedStyle(img).filter),
        { timeout: 5_000 },
      )
      .toBe('none')
  })

  test('settings response: disabling its matching categories reveals a previously-blurred spider photo', async ({
    page,
    serviceWorker,
  }) => {
    // The reference image scores above threshold on BOTH "spiders" and
    // "insects" (a real, expected zero-shot classifier behavior -- spiders
    // are visually close enough to insects to also cross that bar; see
    // similarity.ts's SIMILARITY_THRESHOLD doc comment). Disabling only
    // "spiders" isn't enough to reveal it -- both need to be off.
    await updateSettings(serviceWorker, {
      ...DEFAULT_SETTINGS,
      categories: { ...DEFAULT_SETTINGS.categories, spiders: false, insects: false },
    })

    await page.goto(SPIDER_ARTICLE_URL, { waitUntil: 'load' })
    await page.locator(KNOWN_SPIDER_IMAGE_SELECTOR).first().scrollIntoViewIfNeeded()

    const state = await waitForClassification(page, KNOWN_SPIDER_IMAGE_SELECTOR)
    expect(
      state,
      'the same image that stays blurred at default settings should be revealed once every category it matches is disabled',
    ).toBe('safe')
  })

  test('settings response: disabling the extension entirely reveals every image', async ({
    page,
    serviceWorker,
  }) => {
    await updateSettings(serviceWorker, { ...DEFAULT_SETTINGS, enabled: false })

    await page.goto(SPIDER_ARTICLE_URL, { waitUntil: 'load' })
    // Classification is viewport-gated (content-script.ts's IntersectionObserver):
    // an image that never scrolls into view never gets classified at all,
    // regardless of settings. Scroll through the whole page so every image
    // actually gets triggered, not just the one this test cares about.
    const pageHeight = await page.evaluate(() => document.body.scrollHeight)
    const viewportHeight = await page.evaluate(() => window.innerHeight)
    for (let y = 0; y < pageHeight; y += viewportHeight) {
      await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y)
      await page.waitForTimeout(300)
    }

    // With the extension disabled, background short-circuits every classify
    // request to isSensitive:false, so nothing should stay blurred. The
    // known reference image is the load-bearing assertion; the "almost
    // everything" check tolerates Wikipedia's donation banner, which loads
    // asynchronously and can land after the scroll range above was measured
    // -- unrelated to the settings-response behavior this test verifies.
    expect(await waitForClassification(page, KNOWN_SPIDER_IMAGE_SELECTOR)).toBe('safe')

    await expect
      .poll(
        async () => {
          const filters = await page
            .locator('img')
            .evaluateAll((imgs) => imgs.map((img) => getComputedStyle(img).filter))
          const revealed = filters.filter((f) => f === 'none').length
          return filters.length > 0 && revealed / filters.length
        },
        { timeout: 20_000, intervals: [500, 1000, 2000] },
      )
      .toBeGreaterThan(0.75)
  })
})
