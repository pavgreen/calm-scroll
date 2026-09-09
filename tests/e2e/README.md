# E2E tests

These drive the **real built extension** (`dist/`) in a real Chromium
instance — including actual on-device model inference against live pages —
formalizing the manual verification this project was built and debugged
against throughout development.

Not part of `npm test` (that's the fast, dependency-free unit suite in
`tests/unit/`, run on every change). E2E is heavier and requires setup:

```sh
npm run icons:placeholder
npm run models:fetch-vision       # downloads + vendors the ~45MB fp32 vision encoder
npm run embeddings:precompute     # downloads the text encoder (not kept), writes embeddings
npm run build

npm run test:e2e:install          # one-time: downloads Playwright's Chromium build
npm run test:e2e
```

The fixture (`fixtures.ts`) checks for `dist/` and the vendored vision
model before running anything, and fails with a clear message pointing back
here if either is missing.

## What's covered

- **`classification.spec.ts`** — Wikipedia's "Spider" article, the stable
  reference page used throughout development. Verifies: a real spider photo
  gets blurred and stays blurred at default settings; small icons are never
  left blurred; disabling every category a specific image matches reveals it
  (settings-driven behavior, not just classification — note the reference
  image matches both "spiders" and "insects", a real zero-shot classifier
  outcome, not a bug); disabling the extension entirely reveals everything.
  These are the load-bearing tests — stable, deterministic-enough to trust
  in CI. All 4 pass reliably (~1.5 min total).
- **`category-accuracy.spec.ts`** — one positive real-world reference image
  per phobia category (all 7), plus 3 clearly benign images (food, two
  landscapes) that must never match anything. Classifies directly against
  the offscreen pipeline rather than through a page navigation, since this
  is about model accuracy, not DOM integration — so it's fast (~40s for all
  10, mostly model warm-up) despite covering every category. Every
  reference image was individually verified against the real pipeline
  before being committed; see its file header for why (CLIP zero-shot
  scores don't always match human intuition — e.g. the spiders/insects
  cross-match).
- **`google-images.spec.ts`** — a live Google Images search, included because
  it's a realistic stress case (hundreds of images, no natural scroll pacing)
  this project was specifically debugged against (viewport gating, the
  concurrency limiter). Confirmed during development: Google's bot detection
  reliably redirects this exact automated setup to a `/sorry/` interstitial
  instead of real results, so the test **skips** (not fails) when that
  happens — that's Google blocking the browser, not a signal about the
  extension. If you get real results (different network/IP, Google's
  detection eased up), it'll actually run and verify something meaningful.

## Why not part of `npm test`

Model inference takes real wall-clock time (cold model load + per-image
classification, not mocked), and the vendored model/WASM files are
gitignored (large, regenerate locally — see the root README's "Local setup"
section). Keeping this separate means `npm test` stays fast and dependency-free
for routine iteration, while `npm run test:e2e` gives you the real thing
before shipping a change to the classification/messaging/DOM pipeline.
