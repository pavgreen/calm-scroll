import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json' with { type: 'json' }

export default defineConfig({
  plugins: [crx({ manifest })],
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
