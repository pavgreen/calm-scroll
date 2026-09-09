# CalmScroll

A Chrome extension (Manifest V3) that blurs images likely to trigger common
phobias — spiders, snakes, insects, blood/gore, needles, clowns, dogs — using
an on-device ML model ([Xenova/mobileclip_s0](https://huggingface.co/Xenova/mobileclip_s0),
a transformers.js port of Apple's MobileCLIP-S0). All inference runs locally
in the browser; no network calls at runtime.

## Structure

- `src/content` — scans the page DOM for `<img>` elements, requests
  classification for each, and applies a blur (hover-peek + click-to-toggle)
  to matches.
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

## Model setup (required once, before the extension can classify anything)

The vision model, ONNX Runtime WASM binary, and precomputed category text
embeddings are **not committed to the repo** (they're large/generated —
see `.gitignore`). Generate them locally:

```sh
npm install                       # also vendors the WASM runtime via postinstall
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

Output goes to `dist/`; load that folder as an unpacked extension the same way.

## Typecheck / Lint / Format

```sh
npm run typecheck
npm run lint
npm run format:check
```

## Notes

- `host_permissions: ["<all_urls>"]` in `manifest.json` is a conservative
  placeholder for future `chrome.scripting` needs (e.g. re-injecting into
  dynamically created iframes) — it is **not** required for the static
  content script to run, since that's granted by its own `matches` field.
  Revisit and narrow this before Chrome Web Store submission.
- `icons/*.png` are generated placeholders (solid violet squares) produced by
  `npm run icons:placeholder` (`scripts/generate-placeholder-icons.mjs`, zero
  dependencies, fully offline). Swap in real artwork before shipping.
- **Known follow-ups**: (1) `npm run build` currently also bundles an unused
  duplicate copy of the ONNX Runtime WASM binary as a Vite asset (~23MB dead
  weight, separate from the correctly-vendored copy in `public/ort/` that's
  actually used) — a build-config cleanup, not a functional bug. (2)
  `SIMILARITY_THRESHOLD` in `src/shared/similarity.ts` is calibrated against
  a handful of real images across 2 of 7 categories — broader validation is
  recommended before relying on it. (3) Cross-origin image fetches that are
  blocked by a host's own CORP/CSP headers fail silently to "not sensitive"
  (see the catch block in `src/offscreen/index.ts`) rather than falling back
  to any other signal.
