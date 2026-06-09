// Mirrors docs/API_CONTRACT.md — the single source of truth for data shapes.
// If a shape needs to change, update the contract first, then this file.

// Minimal GeoJSON types (only what the contract uses).
export interface PointGeometry {
  type: 'Point'
  coordinates: [number, number] // [lng, lat]
}

export interface PolygonGeometry {
  type: 'Polygon'
  coordinates: number[][][]
}

export interface LineStringGeometry {
  type: 'LineString'
  coordinates: number[][]
}

export interface Feature<G, P> {
  type: 'Feature'
  geometry: G
  properties: P
}

export interface FeatureCollection<G, P> {
  type: 'FeatureCollection'
  features: Feature<G, P>[]
}

// --- Core entity -------------------------------------------------------------

export type CoverageSource = 'google' | 'unofficial'
export type CoverageStatus = 'OK' | 'ZERO_RESULTS'

export interface CoverageSample {
  pano_id: string
  lat: number
  lng: number
  date: string // "YYYY-MM"
  source: CoverageSource
  status: CoverageStatus
}

// --- GET /api/regions ----------------------------------------------------------

export interface Region {
  id: string
  name: string
  bbox: [number, number, number, number] // [west, south, east, north]
  point_count: number
  last_updated: string // "YYYY-MM-DD"
}

// --- GET /api/coverage/hexbins ---------------------------------------------------

export interface HexbinProperties {
  hex_id: string
  coverage_count: number
  coverage_density: number // 0..1, normalized for color scaling
  avg_age_years: number
  oldest_date: string // "YYYY-MM"
  newest_date: string // "YYYY-MM"
  official_ratio: number // 0..1, share of samples that are "google"
}

export type HexbinCollection = FeatureCollection<PolygonGeometry, HexbinProperties>

// --- GET /api/coverage/points ----------------------------------------------------

export type PointCollection = FeatureCollection<PointGeometry, CoverageSample>

// --- GET /api/coverage/gaps ------------------------------------------------------

export interface GapProperties {
  nearest_road: string
}

export type GapCollection = FeatureCollection<PointGeometry | LineStringGeometry, GapProperties>

// --- GET /api/stats --------------------------------------------------------------

export interface AgeHistogramBin {
  year: number
  count: number
}

export interface RegionStats {
  region: string
  total_samples: number
  covered: number
  coverage_pct: number
  official_pct: number
  avg_age_years: number
  oldest_date: string // "YYYY-MM"
  newest_date: string // "YYYY-MM"
  age_histogram: AgeHistogramBin[]
}
