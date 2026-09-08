# PhobiaSafeBrowsing

A Chrome extension (Manifest V3) that blurs images likely to trigger common
phobias — spiders, snakes, insects, trypophobia, blood/gore, needles, clowns,
dogs, heights — using an on-device ML model (transformers.js + ONNX Runtime
Web). All inference runs locally in the browser; no network calls at runtime.

This repository currently contains the **project skeleton only**: typed
messaging contracts, folder structure per extension surface, and stub logic
with `TODO` markers where the ML classification pipeline will be wired in a
later phase.

## Structure

- `src/content` — scans the page DOM for `<img>` elements and (eventually)
  applies blur overlays to sensitive ones.
- `src/background` — MV3 service worker; routes typed messages between all
  other surfaces and owns settings storage.
- `src/offscreen` — offscreen document; future host for the transformers.js /
  ONNX Runtime WASM worker (offscreen documents can't be declared in
  `manifest.json` — they're created on demand via `chrome.offscreen.createDocument`).
- `src/popup` — quick enable/disable toggle.
- `src/options` — full settings UI (category toggles, sensitivity, allow/deny lists).
- `src/shared` — typed message contracts (`messaging.ts`) and the phobia
  category enum + default settings shape (`categories.ts`), shared by every surface.

## Requirements

- Node.js `v26.8.1`+ (managed via `nvm`; run `nvm use` before installing/building if you switch machines) and npm.

## Develop

```sh
npm install
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
