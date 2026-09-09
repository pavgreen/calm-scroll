import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXTENSION_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist')

function checkPrerequisites(): void {
  if (!existsSync(EXTENSION_PATH)) {
    throw new Error(
      `dist/ not found at ${EXTENSION_PATH}. Run \`npm run build\` before running e2e tests ` +
        '(see tests/e2e/README.md for the full setup, including the model-vendoring steps).',
    )
  }
  if (!existsSync(join(EXTENSION_PATH, 'models', 'mobileclip_s0', 'onnx', 'vision_model.onnx'))) {
    throw new Error(
      'dist/models/ is missing the vision model -- classification will never resolve without it. ' +
        'Run `npm run models:fetch-vision` and `npm run embeddings:precompute`, then `npm run build` again.',
    )
  }
}

/**
 * Waits for background/index.ts's chrome.runtime.onInstalled handler to
 * have written the settings key to chrome.storage.local.
 *
 * Deliberately does NOT verify readiness via chrome.runtime.sendMessage:
 * a service worker messaging ITSELF (calling sendMessage from the same
 * context that registered the matching onMessage listener) was found to be
 * unreliable in this environment -- it fails with "Receiving end does not
 * exist" even once chrome.runtime.onMessage.hasListeners() reports true,
 * both via a bare Playwright script and through this fixture. That's a
 * genuinely different code path from what's actually being tested here
 * (content script -> background, a cross-context send verified extensively
 * during this project's manual testing), so test setup/arrange code below
 * sidesteps it entirely and talks to chrome.storage.local directly instead.
 */
async function waitForServiceWorkerReady(serviceWorker: Worker): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const ready = await serviceWorker
      .evaluate(async () => Boolean((await chrome.storage.local.get('settings')).settings))
      .catch(() => false)
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Service worker did not finish startup (settings never initialized) in time.')
}

interface Fixtures {
  context: BrowserContext
  extensionId: string
  serviceWorker: Worker
}

/**
 * Loads the real built extension into a real (non-headless-shell) Chromium
 * instance, following Playwright's documented pattern for testing Chrome
 * extensions: a persistent context with --load-extension, deriving the
 * extension id from its background service worker's URL.
 *
 * Test-scoped (a fresh context per test, matching Playwright's own
 * documented pattern) rather than sharing one context across a whole file:
 * TypeScript's fixture typing won't allow promoting the built-in `context`
 * fixture to worker scope (its base type is fixed test-scoped), and a
 * separate worker-scoped fixture would need its own `page`-equivalent
 * plumbing to match. The real cost is a cold ~45MB model load per test --
 * see playwright.config.ts's timeout, sized generously to absorb that.
 */
export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    checkPrerequisites()
    const userDataDir = mkdtempSync(join(tmpdir(), 'calm-scroll-e2e-'))
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        '--headless=new',
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
      ],
    })
    // Every ad-hoc script this project's e2e testing was proven against
    // during development included this exact delay immediately after
    // context creation, before any interaction -- launchPersistentContext
    // resolving means the browser process has started, not that Chrome has
    // finished installing/committing the unpacked extension enough for
    // chrome.runtime.sendMessage to route to it (observed: retrying the
    // message itself for a full 15s straight still failed without this).
    await new Promise((resolve) => setTimeout(resolve, 2000))
    await use(context)
    await context.close()
    rmSync(userDataDir, { recursive: true, force: true })
  },

  serviceWorker: async ({ context }, use) => {
    let [serviceWorker] = context.serviceWorkers()
    serviceWorker ??= await context.waitForEvent('serviceworker')
    await waitForServiceWorkerReady(serviceWorker)
    await use(serviceWorker)
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).hostname)
  },
})

export { expect } from '@playwright/test'
