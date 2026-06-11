// API client for the contract in docs/API_CONTRACT.md.
// With USE_MOCKS on, responses come from src/mock/ JSON; the function
// signatures stay identical when the real backend takes over (Step 7).

import type {
  GapCollection,
  HexbinCollection,
  PointCollection,
  Region,
  RegionStats,
} from './types'

export const USE_MOCKS = false

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

// Mocks only exist for the regions in src/mock/ (currently just "madison");
// dynamic import keeps them out of the bundle once USE_MOCKS is off.
async function getMock<T>(name: string): Promise<T> {
  const mod = (await import(`../mock/${name}.json`)) as { default: T }
  return mod.default
}

export async function fetchRegions(): Promise<Region[]> {
  if (USE_MOCKS) return getMock('regions')
  return getJson('/api/regions')
}

// H3 res 10 (~114 m cells): fine enough that the heatmap reads as a continuous
// surface and the polygon layers match the mock's ~200 m grain.
export async function fetchHexbins(region: string, resolution = 10): Promise<HexbinCollection> {
  if (USE_MOCKS) return getMock(`hexbins.${region}`)
  return getJson(`/api/coverage/hexbins?region=${region}&resolution=${resolution}`)
}

export async function fetchPoints(
  region: string,
  bbox?: [number, number, number, number],
): Promise<PointCollection> {
  if (USE_MOCKS) {
    // No point-level mock yet — high-zoom layer arrives with the real backend.
    return { type: 'FeatureCollection', features: [] }
  }
  const bboxParam = bbox ? `&bbox=${bbox.join(',')}` : ''
  return getJson(`/api/coverage/points?region=${region}${bboxParam}`)
}

export async function fetchGaps(region: string): Promise<GapCollection> {
  if (USE_MOCKS) return getMock(`gaps.${region}`)
  return getJson(`/api/coverage/gaps?region=${region}`)
}

export async function fetchStats(region: string): Promise<RegionStats> {
  if (USE_MOCKS) return getMock(`stats.${region}`)
  return getJson(`/api/stats?region=${region}`)
}
