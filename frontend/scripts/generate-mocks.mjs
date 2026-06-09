// Generates the mock JSON in src/mock/ to match docs/API_CONTRACT.md.
// Run from frontend/: node scripts/generate-mocks.mjs
// Deterministic (seeded PRNG) so regenerating doesn't churn the diff.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "mock");

// Madison, WI
const BBOX = [-89.55, 43.02, -89.3, 43.15]; // [west, south, east, north]
const DOWNTOWN = { lng: -89.4012, lat: 43.0731 };
// Rough circles for the lakes so the grid has realistic holes.
const LAKES = [
  { name: "Mendota", lng: -89.42, lat: 43.106, r: 0.032 },
  { name: "Monona", lng: -89.36, lat: 43.062, r: 0.019 },
  { name: "Wingra", lng: -89.425, lat: 43.053, r: 0.007 },
];

// Mulberry32 — tiny seeded PRNG, good enough for mock data.
let seed = 20260609;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const HEX_CHARS = "0123456789abcdef";
function fakeH3Id() {
  let id = "88";
  for (let i = 0; i < 8; i++) id += HEX_CHARS[Math.floor(rand() * 16)];
  return id + "fffff";
}

function inLake(lng, lat) {
  // Compare in roughly metric space (lng compressed by cos(lat)).
  const k = Math.cos((lat * Math.PI) / 180);
  return LAKES.some((l) => Math.hypot((lng - l.lng) * k, lat - l.lat) < l.r);
}

function distFromDowntown(lng, lat) {
  const k = Math.cos((lat * Math.PI) / 180);
  return Math.hypot((lng - DOWNTOWN.lng) * k, lat - DOWNTOWN.lat);
}

function ym(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

// --- Hexbins: pointy-top hex grid over the bbox -------------------------------
// R is the hex circumradius in degrees of latitude; lng distances are scaled by
// 1/cos(lat) so hexes render roughly regular on a web-mercator map.
const R = 0.004;
const LNG_SCALE = 1 / Math.cos((43.085 * Math.PI) / 180);
const COL_W = Math.sqrt(3) * R * LNG_SCALE; // lng step between columns
const ROW_H = 1.5 * R; // lat step between rows

function hexPolygon(cLng, cLat) {
  const ring = [];
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i + 30) * Math.PI) / 180; // pointy-top
    ring.push([
      +(cLng + R * LNG_SCALE * Math.cos(a)).toFixed(6),
      +(cLat + R * Math.sin(a)).toFixed(6),
    ]);
  }
  ring.push(ring[0]);
  return [ring];
}

const hexFeatures = [];
for (let row = 0; ; row++) {
  const lat = BBOX[1] + R + row * ROW_H;
  if (lat > BBOX[3] - R) break;
  const offset = row % 2 === 1 ? COL_W / 2 : 0;
  for (let col = 0; ; col++) {
    const lng = BBOX[0] + COL_W / 2 + offset + col * COL_W;
    if (lng > BBOX[2] - COL_W / 2) break;
    if (inLake(lng, lat)) continue;

    const d = distFromDowntown(lng, lat); // 0 (downtown) .. ~0.12 (edge)
    const density = Math.min(1, Math.max(0.02, 1 - d * 9 + (rand() - 0.5) * 0.35));
    // Sparse rural fringe: drop some of the lowest-density hexes entirely.
    if (density < 0.12 && rand() < 0.55) continue;

    const count = Math.max(3, Math.round(density * 240 + (rand() - 0.5) * 40));
    // Downtown gets re-driven often (newer imagery); the fringe goes stale.
    const avgAge = +Math.min(14, Math.max(0.8, 1.4 + d * 55 + (rand() - 0.5) * 2.5)).toFixed(1);
    const officialRatio = +Math.min(1, Math.max(0.55, 0.97 - d * 1.2 - rand() * 0.12)).toFixed(2);
    const oldestYear = Math.max(2008, Math.round(2024 - avgAge - rand() * 6));
    const newestYear = Math.min(2025, Math.round(2025 - avgAge * 0.3));

    hexFeatures.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: hexPolygon(lng, lat) },
      properties: {
        hex_id: fakeH3Id(),
        coverage_count: count,
        coverage_density: +density.toFixed(2),
        avg_age_years: avgAge,
        oldest_date: ym(oldestYear, 1 + Math.floor(rand() * 12)),
        newest_date: ym(newestYear, 1 + Math.floor(rand() * 12)),
        official_ratio: officialRatio,
      },
    });
  }
}

const hexbins = { type: "FeatureCollection", features: hexFeatures };

// --- Gaps: sample points on roads with no coverage ----------------------------
const ROADS = [
  "W Johnson St", "E Washington Ave", "University Ave", "Monroe St", "Regent St",
  "Atwood Ave", "Mineral Point Rd", "Packers Ave", "S Park St", "Williamson St",
  "N Sherman Ave", "Cottage Grove Rd", "McKee Rd", "Old Sauk Rd", "Milwaukee St",
  "Fish Hatchery Rd", "Gammon Rd", "Northport Dr", "Raymond Rd", "Buckeye Rd",
];

const gapFeatures = [];
while (gapFeatures.length < 42) {
  const lng = BBOX[0] + rand() * (BBOX[2] - BBOX[0]);
  const lat = BBOX[1] + rand() * (BBOX[3] - BBOX[1]);
  if (inLake(lng, lat)) continue;
  // Gaps cluster toward the fringe where coverage is thin.
  if (distFromDowntown(lng, lat) < 0.03 && rand() < 0.8) continue;
  gapFeatures.push({
    type: "Feature",
    geometry: { type: "Point", coordinates: [+lng.toFixed(5), +lat.toFixed(5)] },
    properties: { nearest_road: ROADS[Math.floor(rand() * ROADS.length)] },
  });
}

const gaps = { type: "FeatureCollection", features: gapFeatures };

// --- Stats + regions (totals consistent with the hexbins above) ---------------
const totalCovered = hexFeatures.reduce((s, f) => s + f.properties.coverage_count, 0);
const totalSamples = Math.round(totalCovered / 0.919);
const ageWeighted =
  hexFeatures.reduce((s, f) => s + f.properties.avg_age_years * f.properties.coverage_count, 0) /
  totalCovered;
const officialWeighted =
  hexFeatures.reduce((s, f) => s + f.properties.official_ratio * f.properties.coverage_count, 0) /
  totalCovered;

const histYears = [];
for (let y = 2008; y <= 2025; y++) {
  // Skewed toward recent years, with bumps for big re-drive years.
  let w = Math.pow((y - 2007) / 18, 2.2);
  if (y === 2019 || y === 2022) w *= 1.6;
  histYears.push({ year: y, weight: w });
}
const wSum = histYears.reduce((s, h) => s + h.weight, 0);
const age_histogram = histYears.map((h) => ({
  year: h.year,
  count: Math.round((h.weight / wSum) * totalCovered),
}));

const stats = {
  region: "madison",
  total_samples: totalSamples,
  covered: totalCovered,
  coverage_pct: +((totalCovered / totalSamples) * 100).toFixed(1),
  official_pct: +(officialWeighted * 100).toFixed(1),
  avg_age_years: +ageWeighted.toFixed(1),
  oldest_date: "2008-06",
  newest_date: "2025-11",
  age_histogram,
};

const regions = [
  {
    id: "madison",
    name: "Madison, WI",
    bbox: BBOX,
    point_count: totalSamples,
    last_updated: "2026-06-09",
  },
];

// --- Write ---------------------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });
const files = {
  "regions.json": regions,
  "stats.madison.json": stats,
  "hexbins.madison.json": hexbins,
  "gaps.madison.json": gaps,
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT_DIR, name), JSON.stringify(data, null, 1) + "\n");
}
console.log(
  `Wrote ${Object.keys(files).length} files: ${hexFeatures.length} hexes, ` +
    `${gapFeatures.length} gaps, ${totalSamples} samples (${stats.coverage_pct}% covered).`
);
