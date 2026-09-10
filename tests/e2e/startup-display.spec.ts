import { test, expect } from './fixtures'

/**
 * Verifies the two startupDisplay modes (categories.ts's StartupDisplay doc
 * comment) actually produce the image state they promise at first paint --
 * not just eventually, but specifically BEFORE classification has had any
 * chance to run. This is the one property that's easy to silently break:
 * 'blurred' mode's CSS is now a chrome.scripting.registerContentScripts
 * call made by background/index.ts (see syncBlurCssRegistration), not a
 * static manifest.json content_scripts entry, so there's no manifest-level
 * guarantee left that it actually lands before first paint -- this suite is
 * what confirms it still does.
 *
 * Goes through the real options page UI (not a direct settings write) so
 * SETTINGS_UPDATED actually fires and background's syncBlurCssRegistration
 * runs -- a raw chrome.storage.local write (as classification.spec.ts's
 * updateSettings helper uses for category/sensitivity/enabled tests) would
 * skip that entirely and leave the previous mode's CSS registration in
 * place, silently invalidating the test.
 */

const SPIDER_ARTICLE_URL = 'https://en.wikipedia.org/wiki/Spider'
const KNOWN_SPIDER_IMAGE_SELECTOR = 'img[src*="Araneus_diadematus"]'

async function setStartupDisplay(
  context: import('@playwright/test').BrowserContext,
  extensionId: string,
  value: 'visible' | 'blurred',
): Promise<void> {
  const optionsPage = await context.newPage()
  await optionsPage.goto(`chrome-extension://${extensionId}/src/options/index.html`)
  await optionsPage.locator('#startup-display input').first().waitFor()
  await optionsPage.locator(`#startup-display input[value="${value}"]`).check()
  // persistSettings' SETTINGS_UPDATED round trip + background's
  // chrome.scripting.registerContentScripts call are both async; give them
  // a moment to actually land before the next navigation depends on them.
  await optionsPage.waitForTimeout(800)
  await optionsPage.close()
}

test.describe('startupDisplay modes', () => {
  test("'blurred' mode: images are already blurred at first paint, before classification starts", async ({
    context,
    extensionId,
    page,
  }) => {
    await setStartupDisplay(context, extensionId, 'blurred')

    await page.goto(SPIDER_ARTICLE_URL, { waitUntil: 'domcontentloaded' })
    const immediateFilter = await page
      .locator(KNOWN_SPIDER_IMAGE_SELECTOR)
      .first()
      .evaluate((img) => getComputedStyle(img).filter)

    expect(
      immediateFilter,
      'blurred mode should blur every image immediately via document_start CSS, before this test even had a chance to wait for classification',
    ).toBe('blur(24px)')
  })

  test("'blurred' mode: a <video poster> is also blurred at first paint (not just <img>)", async ({
    context,
    extensionId,
    page,
  }) => {
    await setStartupDisplay(context, extensionId, 'blurred')

    await page.goto(SPIDER_ARTICLE_URL, { waitUntil: 'domcontentloaded' })
    const selector = 'video[data-calm-scroll-test="poster"]'
    await page.evaluate((posterUrl) => {
      const video = document.createElement('video')
      video.poster = posterUrl
      video.dataset.calmScrollTest = 'poster'
      video.style.width = '200px'
      video.style.height = '200px'
      document.body.prepend(video)
    }, 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Araneus_diadematus_%28Clerck%2C_1757%29.JPG/250px-Araneus_diadematus_%28Clerck%2C_1757%29.JPG')

    const immediateFilter = await page
      .locator(selector)
      .evaluate((video) => getComputedStyle(video).filter)

    expect(
      immediateFilter,
      "blur.css's video[poster] selector should blur it immediately, same as img",
    ).toBe('blur(24px)')
  })

  test("'visible' mode (default): images are not blurred at first paint", async ({
    context,
    extensionId,
    page,
  }) => {
    await setStartupDisplay(context, extensionId, 'visible')

    await page.goto(SPIDER_ARTICLE_URL, { waitUntil: 'domcontentloaded' })
    const immediateFilter = await page
      .locator(KNOWN_SPIDER_IMAGE_SELECTOR)
      .first()
      .evaluate((img) => getComputedStyle(img).filter)

    expect(
      immediateFilter,
      'visible mode should never blur an image before classification has had a chance to run',
    ).toBe('none')

    // ...and it should still end up blurred once classification confirms
    // it's sensitive -- covered end-to-end (not just the immediate state)
    // in classification.spec.ts's default-settings test, since that's
    // exactly what DEFAULT_SETTINGS.startupDisplay already is.
  })

  test("the right-click toggle still works correctly in 'visible' mode", async ({
    context,
    extensionId,
    page,
    serviceWorker,
  }) => {
    await setStartupDisplay(context, extensionId, 'visible')

    await page.goto(SPIDER_ARTICLE_URL, { waitUntil: 'load' })
    await page.locator(KNOWN_SPIDER_IMAGE_SELECTOR).first().scrollIntoViewIfNeeded()

    await expect
      .poll(
        () =>
          page
            .locator(KNOWN_SPIDER_IMAGE_SELECTOR)
            .first()
            .evaluate((img) => getComputedStyle(img).filter),
        { timeout: 45_000 },
      )
      .toBe('blur(24px)')

    const imageUrl = await page
      .locator(KNOWN_SPIDER_IMAGE_SELECTOR)
      .first()
      .evaluate((img: HTMLImageElement) => img.currentSrc || img.src)
    const tabId = await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      return tabs[0]?.id
    })
    if (tabId === undefined) throw new Error('no active tab found')

    // Simulates the context menu's onClicked effect directly (Playwright
    // can't trigger a real right-click context menu), same as
    // background/index.ts's own handler: chrome.tabs.sendMessage targeted
    // at this one tab.
    await serviceWorker.evaluate(
      async ({ tabId, imageUrl }) => {
        await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_IMAGE_BLUR', imageUrl })
      },
      { tabId, imageUrl },
    )
    await expect
      .poll(
        () =>
          page
            .locator(KNOWN_SPIDER_IMAGE_SELECTOR)
            .first()
            .evaluate((img) => getComputedStyle(img).filter),
        { timeout: 5_000 },
      )
      .toBe('none')

    await serviceWorker.evaluate(
      async ({ tabId, imageUrl }) => {
        await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_IMAGE_BLUR', imageUrl })
      },
      { tabId, imageUrl },
    )
    await expect
      .poll(
        () =>
          page
            .locator(KNOWN_SPIDER_IMAGE_SELECTOR)
            .first()
            .evaluate((img) => getComputedStyle(img).filter),
        { timeout: 5_000 },
      )
      .toBe('blur(24px)')
  })
})
