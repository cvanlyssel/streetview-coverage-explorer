// Regenerates src/mock/hexbins.madison.json as a fine-resolution hex grid
// (~200 m cells, H3-res-10-ish) so the Density layer reads as a continuous
// heat surface. Deterministic: same output every run.
//
//   node scripts/gen-hexbins.mjs

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const [W, S, E, N] = [-89.55, 43.02, -89.3, 43.15] // madison bbox

const HEX_W = 0.0024 // lng width per cell (~195 m at 43°N)
const HEX_H = HEX_W * 0.84 // lat height, matches the aspect of the old mock

// mulberry32 — seeded so the mock is stable across regenerations
function rng(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = rng(20260609)

// White noise via sine hashing (cheap, deterministic) — uncorrelated per input
function noise(x, y) {
  const v = Math.sin(x * 1271.3 + y * 311.7) * 43758.5453
  return v - Math.floor(v)
}

// Smooth value noise: hash sampled on an integer lattice, smoothstep-interpolated.
// Neighboring inputs correlate, so it produces regional patches, not speckle.
function valueNoise(x, y) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const u = (x - xi) ** 2 * (3 - 2 * (x - xi))
  const v = (y - yi) ** 2 * (3 - 2 * (y - yi))
  const lerp = (a, b, t) => a + (b - a) * t
  return lerp(
    lerp(noise(xi, yi), noise(xi + 1, yi), u),
    lerp(noise(xi, yi + 1), noise(xi + 1, yi + 1), u),
    v,
  )
}

// Coverage density: gaussian blobs over the urban centers
const BLOBS = [
  { x: -89.41, y: 43.08, sx: 0.052, sy: 0.034, amp: 0.2 }, // metro-wide base, keeps the surface connected
  { x: -89.384, y: 43.0735, sx: 0.013, sy: 0.009, amp: 1.0 }, // downtown / isthmus
  { x: -89.412, y: 43.0755, sx: 0.013, sy: 0.009, amp: 0.92 }, // UW campus
  { x: -89.34, y: 43.095, sx: 0.024, sy: 0.018, amp: 0.5 }, // east side
  { x: -89.5, y: 43.062, sx: 0.026, sy: 0.02, amp: 0.45 }, // west / Middleton
  { x: -89.4, y: 43.038, sx: 0.022, sy: 0.014, amp: 0.42 }, // south side
  { x: -89.36, y: 43.13, sx: 0.024, sy: 0.016, amp: 0.32 }, // north side
]

function densityAt(x, y) {
  let d = 0
  for (const b of BLOBS) {
    const dx = (x - b.x) / b.sx
    const dy = (y - b.y) / b.sy
    d += b.amp * Math.exp(-(dx * dx + dy * dy) / 2)
  }
  // Multiplicative street-grid texture: fringe decays to zero instead of
  // flooring at a constant, which would leave a hard rectangular edge.
  return d * (0.85 + 0.3 * noise(x * 90, y * 90))
}

// Lakes punch holes in coverage
const LAKES = [
  { x: -89.425, y: 43.11, rx: 0.045, ry: 0.032 }, // Mendota
  { x: -89.363, y: 43.058, rx: 0.029, ry: 0.019 }, // Monona
  { x: -89.425, y: 43.053, rx: 0.012, ry: 0.006 }, // Wingra
]

function inLake(x, y) {
  return LAKES.some((l) => {
    const dx = (x - l.x) / l.rx
    const dy = (y - l.y) / l.ry
    // Ragged shoreline so lakes don't read as perfect ellipses
    return dx * dx + dy * dy < 0.8 + 0.4 * noise(x * 70, y * 70)
  })
}

const r6 = (v) => Math.round(v * 1e6) / 1e6

function hexPolygon(cx, cy) {
  const w2 = HEX_W / 2
  const h2 = HEX_H / 2
  const h4 = HEX_H / 4
  const ring = [
    [cx, cy + h2],
    [cx + w2, cy + h4],
    [cx + w2, cy - h4],
    [cx, cy - h2],
    [cx - w2, cy - h4],
    [cx - w2, cy + h4],
  ]
  ring.push(ring[0])
  return [ring.map(([x, y]) => [r6(x), r6(y)])]
}

const HEX_CHARS = '0123456789abcdef'
function fakeH3Id() {
  let id = '8acc9f'
  for (let i = 0; i < 6; i++) id += HEX_CHARS[Math.floor(rand() * 16)]
  return id + 'fff'
}

function ym(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`
}

const features = []
const rowStep = HEX_H * 0.75
let maxD = 0
const cells = []

for (let row = 0; ; row++) {
  const cy = S + HEX_H / 2 + row * rowStep
  if (cy > N - HEX_H / 2) break
  const offset = row % 2 === 1 ? HEX_W / 2 : 0
  for (let col = 0; ; col++) {
    const cx = W + HEX_W / 2 + offset + col * HEX_W
    if (cx > E - HEX_W / 2) break
    if (inLake(cx, cy)) continue
    const d = densityAt(cx, cy)
    if (d < 0.06) continue
    cells.push({ cx, cy, d })
    if (d > maxD) maxD = d
  }
}

for (const { cx, cy, d } of cells) {
  const density = Math.round(Math.min(1, d / maxD) * 100) / 100
  if (density < 0.03) continue
  const count = Math.max(1, Math.round(density * 38 * (0.8 + 0.4 * rand())))

  // Denser areas get refreshed more often → younger imagery; regional value-noise
  // patches (camera routes) instead of per-cell speckle
  const ageRaw =
    2 + (1 - density) * 5 + (valueNoise(cx * 30, cy * 30) - 0.5) * 5 + (rand() - 0.5) * 0.6
  const age = Math.round(Math.min(12, Math.max(0.5, ageRaw)) * 10) / 10

  const newestYear = 2025 - Math.floor(rand() * 3)
  const newestMonth = 1 + Math.floor(rand() * (newestYear === 2025 ? 11 : 12))
  const span = Math.max(1, Math.round(age * 1.6))
  const oldestYear = Math.max(2008, newestYear - span)
  const oldestMonth = 1 + Math.floor(rand() * 12)

  // Mostly-Google with clustered photosphere pockets (parks, trails, fringe)
  const pocket = Math.max(0, valueNoise(cx * 24 + 9, cy * 24 + 9) - 0.55) * 2.2
  const officialRaw = 0.96 - (1 - density) * 0.18 - pocket + (rand() - 0.5) * 0.04
  const official = Math.round(Math.min(0.99, Math.max(0.2, officialRaw)) * 100) / 100

  features.push({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: hexPolygon(cx, cy) },
    properties: {
      hex_id: fakeH3Id(),
      coverage_count: count,
      coverage_density: density,
      avg_age_years: age,
      oldest_date: ym(oldestYear, oldestMonth),
      newest_date: ym(newestYear, newestMonth),
      official_ratio: official,
    },
  })
}

const out = { type: 'FeatureCollection', features }
const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mock', 'hexbins.madison.json')
writeFileSync(path, JSON.stringify(out))
console.log(`wrote ${features.length} hexes to ${path}`)
