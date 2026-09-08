import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Solid violet square placeholder icons, generated with Node builtins only
// (no network, no dependencies). Replace with real artwork before shipping.
const ICON_COLOR = [124, 58, 237, 255] // #7C3AED
const ICON_SIZES = [16, 48, 128]

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

function makeSolidPng(size, [r, g, b, a]) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(size, 0)
  ihdrData.writeUInt32BE(size, 4)
  ihdrData[8] = 8 // bit depth
  ihdrData[9] = 6 // color type: RGBA
  const ihdr = chunk('IHDR', ihdrData)

  const row = Buffer.alloc(1 + size * 4) // leading filter-type byte = 0 (none)
  for (let x = 0; x < size; x++) {
    const offset = 1 + x * 4
    row[offset] = r
    row[offset + 1] = g
    row[offset + 2] = b
    row[offset + 3] = a
  }
  const raw = Buffer.concat(Array(size).fill(row))
  const idat = chunk('IDAT', deflateSync(raw))
  const iend = chunk('IEND', Buffer.alloc(0))

  return Buffer.concat([signature, ihdr, idat, iend])
}

mkdirSync(outDir, { recursive: true })
for (const size of ICON_SIZES) {
  writeFileSync(join(outDir, `icon-${size}.png`), makeSolidPng(size, ICON_COLOR))
}
console.log(`Generated placeholder icons in ${outDir}`)
