# CalmScroll

A Chrome extension (Manifest V3) that blurs images likely to trigger common
phobias — spiders, snakes, insects, blood/gore, needles, clowns, dogs — using
an on-device ML model ([Xenova/mobileclip_s0](https://huggingface.co/Xenova/mobileclip_s0),
a transformers.js port of Apple's MobileCLIP-S0). All inference runs locally
in the browser; no network calls at runtime.

## Structure

- `src/content` — scans the page DOM for `<img>` elements and requests
  classification for each; blurring itself is a CSS default (`blur.css`,
  injected at `document_start`) that this script only ever lifts once an
  image is confirmed safe. Toggling a specific image's blur is a right-click
  context menu action, not a click on the image (see `src/background`).
- `src/background` — MV3 service worker; routes typed messages between all
  other surfaces, owns settings storage, and creates/manages the offscreen
  document on demand.
- `src/offscreen` — offscreen document that hosts the on-device transformers.js
  vision model and runs classification off the service-worker thread
  (offscreen documents can't be declared in `manifest.json` — they're created
  at runtime via `chrome.offscreen.createDocument`).
- `src/popup` — quick enable/disable toggle.
- `src/options` — full settings UI (category toggles, sensitivity, allow/deny lists).
- `src/shared` — typed message contracts (`messaging.ts`), the phobia category
  enum + default settings shape (`categories.ts`), zero-shot text prompts per
  category (`prompts.mjs`), and the classification decision logic (`similarity.ts`).

## Requirements

- Node.js `v26.8.1`+ (managed via `nvm`; run `nvm use` before installing/building if you switch machines) and npm.

## Local setup (required once, before the extension will build/run correctly)

The toolbar icons, vision model, ONNX Runtime WASM binary, and precomputed
category text embeddings are all **generated, not committed to the repo**
(see `.gitignore`). Generate them locally:

```sh
npm install                       # also vendors the WASM runtime via postinstall
npm run icons:generate            # generates icons/*.png (zero deps, fully offline)
npm run models:fetch-vision       # downloads + vendors the ~45MB fp32 vision encoder
npm run embeddings:precompute     # downloads the text encoder (~170MB, not kept),
                                   # writes the small category-embeddings.generated.json
```

Each of these hits the network — that's expected and only happens at
dev/build time on your machine, never inside the shipped extension (which
loads everything from its own bundled files with `allowRemoteModels: false`).
Re-run `models:fetch-vision`/`embeddings:precompute` if you ever bump
`@huggingface/transformers` or change the model/prompts.

**Note on precision**: the vision and text encoders both use `dtype: 'fp32'`,
not a quantized variant — verified empirically that `uint8` quantization
collapses this specific model's discriminative signal almost entirely (every
category scored _below_ a "neutral" baseline for every test image), and
`fp16` fails to load at all (an ONNX Runtime graph-optimizer bug specific to
this model's architecture). fp32 is the only precision confirmed to work
correctly here.

## Develop

```sh
npm run dev
```

Then in Chrome: go to `chrome://extensions`, enable **Developer mode**, click
**Load unpacked**, and select the generated `dist/` folder. `@crxjs/vite-plugin`
gives you HMR — most content/background/popup/options edits apply without a
manual extension reload; a full manifest change still needs "Reload" on the
extension card.

## Build

```sh
npm run build
```

Output goes to `dist/`; load that folder as an unpacked extension the same
way. A Vite plugin (`vite.config.ts`) prunes a ~23MB unused duplicate ONNX
Runtime WASM binary that Rollup otherwise bundles as a side effect of
following a reference inside `onnxruntime-web` — the extension always loads
the WASM vendored separately at `public/ort/` instead (see
`src/offscreen/index.ts`'s `wasmPaths` override).

## Typecheck / Lint / Format

```sh
npm run typecheck
npm run lint
npm run format:check
```

## Testing

```sh
npm test          # fast unit tests (src/shared/similarity.ts's decide()) -- no setup needed
npm run test:e2e  # real extension + real model inference against live reference pages
```

`npm test` is dependency-free and runs on every change. `npm run test:e2e`
drives the actual built extension in a real browser (Wikipedia's "Spider"
article, plus a best-effort Google Images check) and needs the full local
setup above done first — see `tests/e2e/README.md`.

## Notes

- `host_permissions: ["<all_urls>"]` in `manifest.json` is **not** a
  placeholder — it's what lets the offscreen document's `fetch()` bypass
  CORS when downloading an arbitrary page's images for classification.
  Verified empirically: with this permission removed, a same-origin-friendly
  host (Wikimedia, which sets a permissive CORS header) still classified
  correctly, but per Chrome's own documented behavior, a host that doesn't
  set `Access-Control-Allow-Origin` would have its images fail closed (stay
  blurred forever, never actually classified) without it — see the
  CORS/CORP follow-up below, which is the same underlying mechanism. Keep
  this permission; when submitting to the Chrome Web Store, its permissions
  justification field should say exactly this (not "future needs").
- `icons/*.png` are generated (a calm sine wave in the brand violet,
  `#7C3AED`) — gitignored, produced by `npm run icons:generate`
  (`scripts/generate-icons.mjs`, zero dependencies, fully offline, no
  third-party asset embedded).
- **Known follow-ups**: (1) `SIMILARITY_THRESHOLD` in
  `src/shared/similarity.ts` is calibrated against a handful of real images
  across 2 of 7 categories — broader validation is recommended before
  relying on it. (2) Cross-origin image fetches that are blocked by a
  host's own CORP/CSP headers (or, per the host_permissions note above, by
  CORS if that permission is ever narrowed) fail closed — the image stays
  blurred forever rather than ever resolving to a real classification — see
  the catch block in `src/offscreen/index.ts`.

## Before submitting to the Chrome Web Store

Not yet done, and blocking a real submission:

- **Privacy Practices disclosure** — the dashboard requires an explicit
  "does this extension collect user data" declaration and, given
  `host_permissions: ["<all_urls>"]`, almost certainly a linked privacy
  policy page even though the true answer is "no data leaves the device"
  (`allowRemoteModels: false`, no analytics, no remote code — worth stating
  plainly on that page).
- **Per-permission justification text** — the dashboard requires a short
  written justification for each of `storage`, `offscreen`, `contextMenus`,
  and `host_permissions`. See the host_permissions note above for that one;
  the other three are self-evident from their names.
- **Single-purpose description** — a short listing description stating the
  one thing this extension does (blur phobia-triggering images, on-device).
  The `manifest.json` description is close but the store listing needs its
  own, longer copy plus at least one screenshot (1280×800 or 640×400) and a
  440×280 small promotional tile.
- **Version bump** — `0.0.1` is fine for a first upload; every subsequent
  upload needs a strictly higher `version`.
- **Package for upload**: zip the _contents_ of `dist/` (not the `dist/`
  folder itself) after `npm run build`.
