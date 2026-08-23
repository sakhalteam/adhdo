/**
 * Render adhdo's app icons to PNG with no image dependencies.
 *
 * The mark is the app itself in miniature: three glowing globs drifting in the
 * nebula, with a faint tether between two of them. Colours come straight from
 * the palette in src/store.ts and the nebula washes in src/index.css.
 *
 * Everything is drawn inside the middle ~64% of the canvas so the same art is
 * safe as a `maskable` icon, where Android may crop to a circle of 80% diameter.
 *
 * Run: node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// ---- PNG encoding --------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** RGBA bytes → a PNG buffer (8-bit truecolour+alpha, no interlace). */
function encodePNG(width, height, rgba) {
  const stride = width * 4
  // Each scanline is prefixed with its filter byte; 0 = None.
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- Palette -------------------------------------------------------------

const BG = [0x0a, 0x0a, 0x1a]
const VIOLET = [0xa7, 0x8b, 0xfa]
const INDIGO = [0x81, 0x8c, 0xf8]
const CYAN = [0x22, 0xd3, 0xee]

const lerp = (a, b, t) => a + (b - a) * t
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const clamp01 = v => Math.max(0, Math.min(1, v))

/** The three globs, positioned to stay inside the maskable safe circle. */
const GLOBS = [
  { x: 0.395, y: 0.44, r: 0.132, color: VIOLET },
  { x: 0.635, y: 0.605, r: 0.098, color: CYAN },
  { x: 0.585, y: 0.285, r: 0.060, color: INDIGO },
]

/** Shortest distance from a point to a segment — used for the tether. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : clamp01(((px - ax) * dx + (py - ay) * dy) / len2)
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Colour of the icon at a point, in canvas-relative units (0..1 both axes). */
function sample(u, v) {
  // Nebula: the same two washes the app paints behind the galaxy.
  const washA = Math.max(0, 1 - Math.hypot((u - 0.2) / 0.9, (v - 0.0) / 0.55))
  const washB = Math.max(0, 1 - Math.hypot((u - 0.9) / 0.85, (v - 1.0) / 0.55))
  let c = mix(BG, VIOLET, washA * washA * 0.22)
  c = mix(c, CYAN, washB * washB * 0.16)

  // Tether between the two larger globs, drawn under them.
  const [g0, g1] = GLOBS
  const tether = distToSegment(u, v, g0.x, g0.y, g1.x, g1.y)
  if (tether < 0.011) c = mix(c, VIOLET, 0.32 * (1 - tether / 0.011))

  for (const g of GLOBS) {
    const d = Math.hypot(u - g.x, v - g.y)
    // Glow first, so nearer globs paint their core over a neighbour's halo.
    if (d < g.r * 2.4) {
      const halo = 1 - d / (g.r * 2.4)
      c = mix(c, g.color, halo * halo * 0.42)
    }
    if (d < g.r) {
      // A soft edge rather than a hard disc — these are blobs, not buttons.
      const edge = clamp01((g.r - d) / (g.r * 0.32))
      c = mix(c, g.color, edge)
      // Inner highlight, offset up-left, to give the blob a little volume.
      const hi = Math.hypot(u - (g.x - g.r * 0.3), v - (g.y - g.r * 0.32))
      if (hi < g.r * 0.55) c = mix(c, [255, 255, 255], (1 - hi / (g.r * 0.55)) * 0.28 * edge)
    }
  }
  return c
}

/** Render at 4x and box-filter down, so every edge lands antialiased. */
function render(size) {
  const SS = 4
  const rgba = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size)
          r += c[0]
          g += c[1]
          b += c[2]
        }
      }
      const n = SS * SS
      const i = (y * size + x) * 4
      rgba[i] = Math.round(clamp01(r / n / 255) * 255)
      rgba[i + 1] = Math.round(clamp01(g / n / 255) * 255)
      rgba[i + 2] = Math.round(clamp01(b / n / 255) * 255)
      rgba[i + 3] = 255
    }
  }
  return encodePNG(size, size, rgba)
}

mkdirSync(OUT, { recursive: true })
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
  ['favicon-32.png', 32],
]) {
  writeFileSync(join(OUT, name), render(size))
  console.log(`wrote public/${name} (${size}x${size})`)
}
