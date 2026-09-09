import { cpSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Vendors the ONNX Runtime Web WASM/JSEP runtime files that
// @huggingface/transformers needs at inference time, so the offscreen
// document never fetches them from a CDN (required for "no network calls
// at runtime" and for offline/CSP correctness under MV3). Pure copy from
// node_modules, no network access of its own — safe to run on every
// install via the postinstall hook.
//
// NOTE: the actual .wasm binaries live under onnxruntime-web's own dist/,
// NOT @huggingface/transformers/dist/ (which only re-ships the small .mjs
// loader — copying just that file is not enough, the loader is useless
// without its multi-megabyte .wasm companion).
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'node_modules', 'onnxruntime-web', 'dist')
const outDir = join(root, 'public', 'ort')

// Vendor the SIMD "asyncify" build (non-threaded — doesn't require
// SharedArrayBuffer/cross-origin isolation). Verified empirically: MV3
// offscreen documents are NOT cross-origin isolated, so the threaded JSEP
// build (which needs SharedArrayBuffer) fails to initialize and
// onnxruntime-web falls back to asyncify — vendor what's actually used,
// not the whole onnxruntime-web dist/ (which also ships WebGL/WebGPU/Node/
// JSEP/JSPI variants we don't need, ~100MB+ combined).
const NEEDED_FILES = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']

mkdirSync(outDir, { recursive: true })
const available = new Set(readdirSync(srcDir))
const missing = NEEDED_FILES.filter((f) => !available.has(f))
if (missing.length > 0) {
  throw new Error(
    `Expected ONNX Runtime files not found in ${srcDir}: ${missing.join(', ')} — the installed onnxruntime-web version's dist/ layout may have changed; inspect it and update NEEDED_FILES.`,
  )
}
for (const f of NEEDED_FILES) cpSync(join(srcDir, f), join(outDir, f))
console.log(`Vendored ONNX runtime files: ${NEEDED_FILES.join(', ')} -> ${outDir}`)
