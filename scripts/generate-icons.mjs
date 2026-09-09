import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Generates the extension's icon set: a calm sine wave rendered in the
 * brand color, with Node builtins only (no dependencies, no network,
 * matching the project's existing "generate deterministic assets at build
 * time" pattern). Antialiased by supersampling each pixel on a 4x4 subgrid
 * and averaging coverage, rather than a hard threshold, since the smallest
 * size (16px) would otherwise look jagged.
 */
const ICON_COLOR = [124, 58, 237] // #7C3AED, unchanged from the placeholder icons
const ICON_SIZES = [16, 48, 128]
const SUPERSAMPLE = 4

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons')

let crcTable
function crc32(buf) {
  crcTable ??= (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
    return table
  })()
  let crc = 0xffffffff
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([length, typeBuf, data, crc])
}

// Distance from (x, y) to the sine curve, sampled densely along x rather
// than solved analytically -- plenty cheap at these sizes. Phase is
// measured from `margin` (not 0) so the curve starts and ends at the
// midline (sin(0) = sin(cycles * 2*pi) = 0) regardless of size, giving
// clean flat-height edges instead of an arbitrary cut mid-slope.
function distanceToWave(x, y, margin, innerWidth, amplitude, cycles, midY) {
  let best = Infinity
  const steps = innerWidth * 2
  for (let i = 0; i <= steps; i++) {
    const sx = margin + (i / steps) * innerWidth
    const sy = midY - amplitude * Math.sin((2 * Math.PI * cycles * (sx - margin)) / innerWidth)
    const dx = sx - x
    const dy = sy - y
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d < best) best = d
  }
  return best
}

function makeWavePng(size, [r, g, b]) {
  const margin = size * 0.18
  const innerWidth = size - margin * 2
  const amplitude = (size - margin * 2) / 4
  const midY = size / 2
  const cycles = 1.5
  const strokeHalfWidth = Math.max(size * 0.05, 0.7)

  const pixels = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let coverage = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const px = x + (sx + 0.5) / SUPERSAMPLE
          const py = y + (sy + 0.5) / SUPERSAMPLE
          if (px < margin || px > size - margin) continue
          const d = distanceToWave(px, py, margin, innerWidth, amplitude, cycles, midY)
          if (d <= strokeHalfWidth) coverage++
        }
      }
      const alpha = (coverage / (SUPERSAMPLE * SUPERSAMPLE)) * 255
      const offset = (y * size + x) * 4
      pixels[offset] = r
      pixels[offset + 1] = g
      pixels[offset + 2] = b
      pixels[offset + 3] = alpha
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(size, 0)
  ihdrData.writeUInt32BE(size, 4)
  ihdrData[8] = 8 // bit depth
  ihdrData[9] = 6 // color type: RGBA
  const ihdr = chunk('IHDR', ihdrData)

  const raw = Buffer.alloc(size * (1 + size * 4))
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4)
    raw[rowStart] = 0 // filter type: none
    raw.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), rowStart + 1)
  }
  const idat = chunk('IDAT', deflateSync(raw))
  const iend = chunk('IEND', Buffer.alloc(0))

  return Buffer.concat([signature, ihdr, idat, iend])
}

mkdirSync(outDir, { recursive: true })
for (const size of ICON_SIZES) {
  writeFileSync(join(outDir, `icon-${size}.png`), makeWavePng(size, ICON_COLOR))
}
console.log(`Generated icons in ${outDir}`)
