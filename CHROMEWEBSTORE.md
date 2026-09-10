# Chrome Web Store Listing — Calm Scroll

> Last Updated: 2026-09-10
> Status: draft — fields marked TODO need your input before submission.

## Store Listing

**Extension Name**

Calm Scroll
<!-- Must match manifest.json "name" exactly. It does. -->

**Short Description** (123/132 chars, matches manifest.json)

Blurs phobia images (spiders, snakes, insects, gore, needles, clowns, dogs) with on-device ML. No network calls at runtime.

**Detailed Description** (draft — edit freely)

```
Calm Scroll automatically blurs images that commonly trigger phobias, so you can browse without being ambushed by them.

FEATURES
Blurs spiders, snakes, insects, blood/gore, needles, clowns, and dogs — choose which categories matter to you
Runs entirely on your device: images are never uploaded anywhere, and the extension makes no network requests
Adjustable sensitivity, so you control how cautious the blurring is
Hover to peek at a blurred image, or right-click any image to toggle its blur on or off
Choose your blur timing: show images normally and blur the sensitive ones as they're found (the default), or blur everything up front and reveal each image once it's confirmed safe

HOW TO USE
1. Install the extension — it's on by default
2. Click the toolbar icon to quickly enable/disable it, or open Settings for full control
3. In Settings, choose which categories to blur, how sensitive detection should be, and your preferred blur timing
4. Right-click any image and choose "Calm Scroll - Toggle Image Blur" to reveal or re-hide it on the spot

PRIVACY
Calm Scroll does not collect, store, or transmit any personal data. All image analysis happens locally on your device using a bundled on-device model — no image or browsing data is ever sent to a server. See the full privacy policy for details.

PERMISSIONS
"Read and change data on all your websites" — needed to find and blur images on any page you visit, and to load the small amount of code (right-click menu, blur styling) that makes that work. Images are analyzed on-device only.

SUPPORT
Found a bug or have a suggestion? Open an issue at https://github.com/pavgreen/calm-scroll/issues.

Version 0.0.1
```

**Category**

Accessibility

**Single Purpose**

Blurs images on web pages that are likely to trigger common phobias, using an on-device model.

**Primary Language**

English

## Graphics & Assets

| Asset                   | Dimensions          | Status         | Filename                                        |
| ----------------------- | ------------------- | -------------- | ----------------------------------------------- |
| Store Icon              | 128×128 PNG         | ✅ Ready       | `icons/icon-128.png` (`npm run icons:generate`) |
| Screenshot 1 (required) | 1280×800 or 640×400 | ⬜ Not created |                                                 |
| Screenshot 2            | 1280×800 or 640×400 | ⬜ Not created |                                                 |
| Small Promo Tile        | 440×280             | ⬜ Not created |                                                 |

### Screenshot Notes

Show the options page (category toggles + sensitivity) and a real page with
a blurred image mid-hover-peek — those two communicate the whole product
faster than the popup alone.

## Permissions Justification

| Permission     | Type             | Justification                                                                                                                                                                                                                                                                                                                               |
| -------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`      | permissions      | Stores the user's settings (enabled categories, sensitivity level, on/off toggle) locally via `chrome.storage.local`. Never synced or transmitted.                                                                                                                                                                                          |
| `offscreen`    | permissions      | Hosts the on-device image-classification model in an offscreen document so inference runs off the service worker's thread and isn't killed by the service worker's idle timeout.                                                                                                                                                            |
| `contextMenus` | permissions      | Adds the "Calm Scroll - Toggle Image Blur" right-click item on images, letting users manually reveal or re-hide a specific image.                                                                                                                                                                                                           |
| `scripting`    | permissions      | Registers/unregisters the document-start stylesheet that blurs every image immediately, only when the user has selected the "blur everything first" timing option in Settings (off by default). No JavaScript is injected via this permission — CSS only.                                                                                   |
| `<all_urls>`   | host_permissions | The extension blurs sensitive images on any website, not a fixed list — this is its whole purpose. It's also what lets the offscreen document's `fetch()` bypass CORS when downloading an arbitrary page's images for on-device classification; without it, images on sites that don't set a permissive CORS header would fail to classify. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

| Data Type                      | Collected?                                            | Transmitted Off-Device? | Purpose                                                     | Shared with Third Parties? |
| ------------------------------ | ----------------------------------------------------- | ----------------------- | ----------------------------------------------------------- | -------------------------- |
| Personally identifiable info   | No                                                    | No                      | —                                                           | No                         |
| Health info                    | No                                                    | No                      | —                                                           | No                         |
| Financial info                 | No                                                    | No                      | —                                                           | No                         |
| Authentication info            | No                                                    | No                      | —                                                           | No                         |
| Personal communications        | No                                                    | No                      | —                                                           | No                         |
| Location                       | No                                                    | No                      | —                                                           | No                         |
| Web history                    | No                                                    | No                      | —                                                           | No                         |
| User activity                  | No                                                    | No                      | —                                                           | No                         |
| Website content (image pixels) | Read locally to classify, never stored or transmitted | No                      | On-device classification of whether an image needs blurring | No                         |

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**

https://pavgreen.github.io/calm-scroll/PRIVACY.html

<!-- Repo is public and GitHub Pages is enabled (legacy Jekyll build,
     source: main branch root) -- confirm this exact URL resolves after
     pushing PRIVACY.md's front matter (Jekyll needs it to convert the
     .md into a real .html page instead of serving raw markdown text). -->

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Publisher Name**

TODO

**Contact Email**

pavgreen@gmail.com

**Support URL / Email**

https://github.com/pavgreen/calm-scroll/issues

**Homepage URL**

https://github.com/pavgreen/calm-scroll

## Version History

| Version | Date | Changes            | Status |
| ------- | ---- | ------------------ | ------ |
| 0.0.1   |      | Initial submission | Draft  |

## Review Notes

### Known Issues / Limitations

- `SIMILARITY_THRESHOLD` (see `src/shared/similarity.ts`) is confirmed to
  work on one real reference image per category across all 7 categories —
  not yet a broad labeled set (no multiple images per category, no
  near-miss examples) — expect some misses/false positives until that's
  done.
- Only `<img>` elements are scanned — CSS `background-image`,
  `<picture>`/`<source>`, and `<video poster>` images are never classified
  or blurred.
- Cross-origin image fetches blocked by a host's own CORP/CSP headers fail
  closed (image stays blurred, never resolves) rather than falling back to
  any other signal.
- At the default "show, then blur" timing, a sensitive image can be visible
  for the brief window between page load and classification finishing —
  this is the accepted tradeoff of that mode (see README's "Blur timing"
  section), not a bug. Users who want zero exposure window can switch to
  "blur, then show" in Settings.

### Rejection History

<!-- | Date | Reason | Fix Applied | Resubmitted | -->
