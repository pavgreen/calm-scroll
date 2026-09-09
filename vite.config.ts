import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json' with { type: 'json' }

/**
 * onnxruntime-web (a transitive dependency of @huggingface/transformers,
 * used by the offscreen document) resolves its own WASM binary via a
 * `new URL(..., import.meta.url)`-style reference, which Rollup follows and
 * bundles as a ~23MB dist/assets/*.wasm file. That reference is never
 * actually taken at runtime, though: src/offscreen/index.ts sets
 * env.backends.onnx.wasm.wasmPaths to chrome.runtime.getURL('ort/') *before*
 * any model load, which points onnxruntime-web at the separately-vendored,
 * correct (non-threaded "asyncify") copy in public/ort/ instead — see
 * scripts/copy-onnxruntime-wasm.mjs. The bundled copy is dead weight
 * (pure download-size bloat, confirmed unreferenced by any code path this
 * extension actually runs) and is pruned here after build.
 */
function pruneUnusedOnnxWasm(): Plugin {
  return {
    name: 'prune-unused-onnx-wasm',
    closeBundle() {
      const assetsDir = 'dist/assets'
      for (const file of readdirSync(assetsDir)) {
        if (file.startsWith('ort-wasm') && file.endsWith('.wasm')) {
          rmSync(join(assetsDir, file))
        }
      }
    },
  }
}

/**
 * Vite's public/ passthrough copies files verbatim, including whatever
 * macOS Finder metadata (.DS_Store) happened to accumulate in public/ and
 * public/models/ on a given developer's machine during local testing --
 * these aren't committed (gitignored globally), but they're real files on
 * disk that a local build will still copy into dist/, and from there into a
 * Chrome Web Store upload if nobody notices. Swept recursively after build
 * rather than just the folders known to have them today, since new ones can
 * appear anywhere under public/ without warning.
 */
function pruneDsStore(): Plugin {
  return {
    name: 'prune-ds-store',
    closeBundle() {
      for (const file of readdirSync('dist', { recursive: true }) as string[]) {
        if (file.endsWith('.DS_Store')) rmSync(join('dist', file))
      }
    },
  }
}

export default defineConfig({
  plugins: [crx({ manifest }), pruneUnusedOnnxWasm(), pruneDsStore()],
  build: {
    rollupOptions: {
      input: {
        // Offscreen documents are created at runtime via chrome.offscreen.createDocument,
        // never referenced from manifest.json, so crxjs won't auto-discover this entry.
        offscreen: 'src/offscreen/index.html',
      },
    },
  },
})
