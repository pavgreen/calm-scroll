import { test, expect } from './fixtures'

/**
 * Best-effort test against a live Google Images search. Unlike the
 * Wikipedia suite (classification.spec.ts), this depends on a page we
 * don't control: Google's markup, its result set for a given query, and
 * its bot-detection posture can all change independently of this
 * extension. It's included because a search results page is a realistic
 * stress case this project was specifically debugged against (hundreds of
 * images, no natural scroll pacing -- see the viewport-gating /
 * concurrency-limiting work in content-script.ts), but keep expectations
 * loose here: if this test starts failing, check whether Google's page
 * changed before assuming a regression in the extension.
 *
 * Confirmed during development: Google's bot detection reliably redirects
 * automated traffic (this exact Playwright/Chromium setup, run from this
 * environment) to a /sorry/ "unusual traffic" interstitial instead of real
 * results. That's Google blocking the *browser*, not a signal about this
 * extension -- skip rather than fail when it happens, so this stays an
 * honest "couldn't verify" instead of a false "broken."
 */
test('image search results: at least one spider image ends up blurred', async ({ page }) => {
  await page.goto('https://www.google.com/search?q=spider&udm=2', { waitUntil: 'domcontentloaded' })

  test.skip(
    page.url().includes('/sorry/'),
    'Google redirected to its bot-detection interstitial instead of real results -- ' +
      'not something this extension can control or this test can verify around.',
  )

  // Let the page's own lazy-loading populate images, then scroll a little
  // to bring more into the viewport-gated classification range.
  await page.waitForTimeout(3_000)
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 800)
    await page.waitForTimeout(1_000)
  }

  await expect
    .poll(
      async () => {
        const filters = await page
          .locator('img')
          .evaluateAll((imgs) => imgs.map((img) => getComputedStyle(img).filter))
        return filters.filter((f) => f !== 'none' && f.includes('blur')).length
      },
      { timeout: 45_000, intervals: [1000, 2000, 3000] },
    )
    .toBeGreaterThan(0)
})
