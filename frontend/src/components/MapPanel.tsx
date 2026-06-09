// Central map: MapLibre dark basemap with the deck.gl Density hexbin layer on top.

import { useEffect, useMemo, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { PolygonLayer } from '@deck.gl/layers'
import { HeatmapLayer } from '@deck.gl/aggregation-layers'
import type { Feature, HexbinCollection, HexbinProperties, PolygonGeometry, Region } from '../api/types'
import { HEAT_COLOR_RANGE, HEAT_GRADIENT_CSS } from '../lib/colors'

const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

type HexFeature = Feature<PolygonGeometry, HexbinProperties>

function centroid(f: HexFeature): [number, number] {
  const ring = f.geometry.coordinates[0]
  let x = 0
  let y = 0
  for (let i = 0; i < 6; i++) {
    x += ring[i][0]
    y += ring[i][1]
  }
  return [x / 6, y / 6]
}

function buildLayers(hexbins: HexbinCollection | null) {
  if (!hexbins) return []
  return [
    // Smooth heat surface for the visual
    new HeatmapLayer<HexFeature>({
      id: 'density-heatmap',
      data: hexbins.features,
      getPosition: centroid,
      getWeight: (f) => f.properties.coverage_count,
      colorRange: HEAT_COLOR_RANGE.map(([r, g, b]) => [r, g, b, 255]),
      radiusPixels: 28,
      intensity: 1.1,
      threshold: 0.05,
      aggregation: 'SUM',
    }),
    // Invisible hex layer so per-cell hover tooltips keep working
    new PolygonLayer<HexFeature>({
      id: 'density-hexbins-pick',
      data: hexbins.features,
      getPolygon: (f) => f.geometry.coordinates[0],
      // Invisible over the dark basemap, but alpha > 0 so picking registers
      getFillColor: [0, 0, 0, 8],
      stroked: false,
      pickable: true,
    }),
  ]
}

function tooltipFor(object: HexFeature | null) {
  if (!object) return null
  const p = object.properties
  return {
    html: `
      <div style="font-weight:600;margin-bottom:4px">${p.coverage_count.toLocaleString()} panoramas</div>
      <div>Avg age: ${p.avg_age_years.toFixed(1)} yrs</div>
      <div>Official: ${Math.round(p.official_ratio * 100)}%</div>
      <div style="color:#9ca3af">${p.oldest_date} – ${p.newest_date}</div>
    `,
    style: {
      background: 'rgba(20,22,28,0.95)',
      color: '#e5e7eb',
      fontSize: '12px',
      borderRadius: '8px',
      padding: '8px 10px',
      border: '1px solid rgba(255,255,255,0.1)',
    },
  }
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-7 left-2.5 z-10 rounded-md border border-white/10 bg-[#14161c]/90 px-2.5 py-2 backdrop-blur">
      <div className="text-[10px] font-medium text-zinc-300">Coverage density</div>
      <div className="mt-1 h-1.5 w-28 rounded-full" style={{ background: HEAT_GRADIENT_CSS }} />
      <div className="mt-0.5 flex justify-between text-[9px] text-zinc-500">
        <span>Low</span>
        <span>High</span>
      </div>
    </div>
  )
}

export function MapPanel({
  region,
  hexbins,
}: {
  region: Region | null
  hexbins: HexbinCollection | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const layers = useMemo(() => buildLayers(hexbins), [hexbins])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      // Initial camera: framed on the default region so the first paint is right
      // even before the regions fetch resolves and the fitBounds effect runs.
      bounds: [-89.55, 43.02, -89.3, 43.15],
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
    const overlay = new MapboxOverlay({
      layers: [],
      getTooltip: ({ object }) => tooltipFor((object as HexFeature) ?? null),
    })
    map.addControl(overlay)
    mapRef.current = map
    overlayRef.current = overlay
    return () => {
      map.remove()
      mapRef.current = null
      overlayRef.current = null
    }
  }, [])

  useEffect(() => {
    overlayRef.current?.setProps({ layers })
  }, [layers])

  useEffect(() => {
    if (!region || !mapRef.current) return
    const [w, s, e, n] = region.bbox
    mapRef.current.fitBounds([w, s, e, n], { padding: 24, duration: 1200 })
  }, [region])

  return (
    <div className="relative flex-1 overflow-hidden rounded-xl border border-white/[0.06]">
      {/* h-full (not absolute inset-0): maplibre css forces position:relative on this node */}
      <div ref={containerRef} className="h-full w-full" />
      <Legend />
    </div>
  )
}
