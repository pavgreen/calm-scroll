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
 *
 * NOTE: this does NOT trigger syncBlurCssRegistration (background/index.ts) --
 * that only runs off the SETTINGS_UPDATED message itself, not a raw storage
 * write, so a test that needs the *startupDisplay*-driven document_start CSS
 * to actually change should go through the options page UI instead (see
 * startup-display.spec.ts). Tests in this file that only exercise
 * categories/sensitivity/enabled are unaffected, since those are read fresh
 * from storage on every classify request regardless of how they got saved.
 */
async function updateSettings(
  serviceWorker: import('@playwright/test').Worker,
  settings: ExtensionSettings,
): Promise<void> {
  await serviceWorker.evaluate(async (s) => chrome.storage.local.set({ settings: s }), settings)
}

async function currentFilter(
  page: import('@playwright/test').Page,
  selector: string,
): Promise<string> {
  return page
    .locator(selector)
    .first()
    .evaluate((img) => getComputedStyle(img).filter)
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

  test('a real spider photo is classified as sensitive and ends up blurred at default settings', async ({
    page,
  }) => {
    await page.goto(SPIDER_ARTICLE_URL, { waitUntil: 'load' })
    await page.locator(KNOWN_SPIDER_IMAGE_SELECTOR).first().scrollIntoViewIfNeeded()

    // DEFAULT_SETTINGS.startupDisplay is 'visible' -- the image starts
    // unblurred and only becomes blurred once classification confirms it's
    // sensitive, so the assertion here is on the settled end state, not an
    // immediate one (that direction is covered explicitly in
    // startup-display.spec.ts).
    await expect
      .poll(() => currentFilter(page, KNOWN_SPIDER_IMAGE_SELECTOR), { timeout: 45_000 })
      .toBe('blur(24px)')
  })

  test('non-photo UI chrome (small icons) is never blurred', async ({ page }) => {
    await page.goto(SPIDER_ARTICLE_URL, { waitUntil: 'load' })
    // The Wikipedia wordmark is a small logo present on every article; it's
    // below the 32px icon-exclusion threshold in content-script.ts and is
    // excluded from classification entirely (observeImage's isLikelyIcon
    // short-circuit), so it should never be blurred in the first place.
    const selector = 'img[src*="wikipedia-wordmark"]'
    await expect.poll(() => currentFilter(page, selector), { timeout: 5_000 }).toBe('none')
  })

  test('settings response: disabling its matching categories keeps a spider photo unblurred', async ({
    page,
    serviceWorker,
  }) => {
    // The reference image scores above threshold on BOTH "spiders" and
    // "insects" (a real, expected zero-shot classifier behavior -- spiders
    // are visually close enough to insects to also cross that bar; see
    // similarity.ts's SIMILARITY_THRESHOLD doc comment). Disabling only
    // "spiders" isn't enough -- both need to be off.
    await updateSettings(serviceWorker, {
      ...DEFAULT_SETTINGS,
      categories: { ...DEFAULT_SETTINGS.categories, spiders: false, insects: false },
    })

    await page.goto(SPIDER_ARTICLE_URL, { waitUntil: 'load' })
    await page.locator(KNOWN_SPIDER_IMAGE_SELECTOR).first().scrollIntoViewIfNeeded()

    // With every category it matches disabled, classification never reports
    // it sensitive, so at default (visible) startupDisplay it should simply
    // stay unblurred throughout -- there's no "reveal" transition to wait
    // for the way there would be in 'blurred' mode, so this asserts the
    // settled state stays 'none' across a real wait, not just an instant.
    await page.waitForTimeout(8_000)
    expect(
      await currentFilter(page, KNOWN_SPIDER_IMAGE_SELECTOR),
      'the same image that ends up blurred at default settings should stay unblurred once every category it matches is disabled',
    ).toBe('none')
  })

  test('settings response: disabling the extension entirely leaves every image unblurred', async ({
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
    // request to isSensitive:false, so nothing should ever become blurred.
    // The known reference image is the load-bearing assertion; the "almost
    // everything" check tolerates Wikipedia's donation banner, which loads
    // asynchronously and can land after the scroll range above was measured
    // -- unrelated to the settings-response behavior this test verifies.
    await page.waitForTimeout(8_000)
    expect(await currentFilter(page, KNOWN_SPIDER_IMAGE_SELECTOR)).toBe('none')

    await expect
      .poll(
        async () => {
          const filters = await page
            .locator('img')
            .evaluateAll((imgs) => imgs.map((img) => getComputedStyle(img).filter))
          const unblurred = filters.filter((f) => f === 'none').length
          return filters.length > 0 && unblurred / filters.length
        },
        { timeout: 20_000, intervals: [500, 1000, 2000] },
      )
      .toBeGreaterThan(0.75)
  })
})
