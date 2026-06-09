// Central map: MapLibre dark basemap with the active deck.gl data layer on top.
// Layer switches cross-fade by rendering the outgoing and incoming layers
// together while a framer-motion tween drives their opacities.

import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import { HeatmapLayer } from '@deck.gl/aggregation-layers'
import { animate, AnimatePresence, motion } from 'framer-motion'
import type {
  Feature,
  GapCollection,
  GapProperties,
  HexbinCollection,
  HexbinProperties,
  PointGeometry,
  PolygonGeometry,
  Region,
} from '../api/types'
import {
  AGE_GRADIENT_CSS,
  GAP_COLOR,
  HEAT_COLOR_RANGE,
  HEAT_GRADIENT_CSS,
  OFFICIAL_GRADIENT_CSS,
  ageColor,
  officialColor,
} from '../lib/colors'
import { useAppState, type LayerId } from '../state/store'

const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

type HexFeature = Feature<PolygonGeometry, HexbinProperties>
type GapPointFeature = Feature<PointGeometry, GapProperties>
type PickedFeature = HexFeature | GapPointFeature

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

function layersFor(
  layerId: LayerId,
  hexbins: HexbinCollection | null,
  gaps: GapCollection | null,
  opacity: number,
  pickable: boolean,
) {
  switch (layerId) {
    case 'density':
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
          opacity,
        }),
        // Invisible hex layer so per-cell hover tooltips keep working
        new PolygonLayer<HexFeature>({
          id: 'density-pick',
          data: hexbins.features,
          getPolygon: (f) => f.geometry.coordinates[0],
          // Invisible over the dark basemap, but alpha > 0 so picking registers
          getFillColor: [0, 0, 0, 8],
          stroked: false,
          pickable,
        }),
      ]
    case 'age':
      if (!hexbins) return []
      return [
        new PolygonLayer<HexFeature>({
          id: 'age-hexes',
          data: hexbins.features,
          getPolygon: (f) => f.geometry.coordinates[0],
          getFillColor: (f) => [...ageColor(f.properties.avg_age_years), 215],
          stroked: false,
          pickable,
          opacity,
        }),
      ]
    case 'official':
      if (!hexbins) return []
      return [
        new PolygonLayer<HexFeature>({
          id: 'official-hexes',
          data: hexbins.features,
          getPolygon: (f) => f.geometry.coordinates[0],
          getFillColor: (f) => [...officialColor(f.properties.official_ratio), 215],
          stroked: false,
          pickable,
          opacity,
        }),
      ]
    case 'gaps':
      if (!gaps) return []
      return [
        new ScatterplotLayer<GapPointFeature>({
          id: 'gaps-points',
          data: gaps.features.filter((f): f is GapPointFeature => f.geometry.type === 'Point'),
          getPosition: (f) => f.geometry.coordinates,
          getFillColor: [...GAP_COLOR, 230],
          getLineColor: [255, 255, 255, 140],
          stroked: true,
          lineWidthMinPixels: 1,
          radiusMinPixels: 3.5,
          radiusMaxPixels: 8,
          pickable,
          opacity,
        }),
      ]
  }
}

function tooltipFor(object: PickedFeature | null) {
  if (!object) return null
  const p = object.properties
  const html =
    'nearest_road' in p
      ? `
        <div style="font-weight:600;margin-bottom:2px;color:#fca5a5">Coverage gap</div>
        <div>No Street View near <b>${p.nearest_road}</b></div>
      `
      : `
        <div style="font-weight:600;margin-bottom:4px">${p.coverage_count.toLocaleString()} panoramas</div>
        <div>Avg age: ${p.avg_age_years.toFixed(1)} yrs</div>
        <div>Official: ${Math.round(p.official_ratio * 100)}%</div>
        <div style="color:#9ca3af">${p.oldest_date} – ${p.newest_date}</div>
      `
  return {
    html,
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

const LEGENDS: Record<
  LayerId,
  { title: string; gradient?: string; left?: string; right?: string; dot?: string }
> = {
  density: { title: 'Coverage density', gradient: HEAT_GRADIENT_CSS, left: 'Low', right: 'High' },
  age: { title: 'Avg imagery age', gradient: AGE_GRADIENT_CSS, left: '0 yrs', right: '10+ yrs' },
  official: {
    title: 'Coverage source',
    gradient: OFFICIAL_GRADIENT_CSS,
    left: 'Unofficial',
    right: 'Google',
  },
  gaps: { title: 'Coverage gaps', dot: 'Road with no Street View' },
}

function Legend({ layerId }: { layerId: LayerId }) {
  const cfg = LEGENDS[layerId]
  return (
    <div className="pointer-events-none absolute bottom-7 left-2.5 z-10">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={layerId}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.18 }}
          className="rounded-md border border-white/10 bg-[#14161c]/90 px-2.5 py-2 backdrop-blur"
        >
          <div className="text-[10px] font-medium text-zinc-300">{cfg.title}</div>
          {cfg.gradient ? (
            <>
              <div className="mt-1 h-1.5 w-28 rounded-full" style={{ background: cfg.gradient }} />
              <div className="mt-0.5 flex justify-between text-[9px] text-zinc-500">
                <span>{cfg.left}</span>
                <span>{cfg.right}</span>
              </div>
            </>
          ) : (
            <div className="mt-1 flex items-center gap-1.5 text-[9px] text-zinc-500">
              <span
                className="h-2 w-2 rounded-full ring-1 ring-white/40"
                style={{ background: `rgb(${GAP_COLOR.join(',')})` }}
              />
              {cfg.dot}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

export function MapPanel({
  region,
  hexbins,
  gaps,
}: {
  region: Region | null
  hexbins: HexbinCollection | null
  gaps: GapCollection | null
}) {
  const { activeLayer } = useAppState()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)

  // Cross-fade: prev holds the outgoing layer until the tween finishes
  const [fade, setFade] = useState<{ prev: LayerId | null; t: number }>({ prev: null, t: 1 })
  const shownLayerRef = useRef(activeLayer)

  useEffect(() => {
    if (shownLayerRef.current === activeLayer) return
    const from = shownLayerRef.current
    shownLayerRef.current = activeLayer
    const controls = animate(0, 1, {
      duration: 0.45,
      ease: 'easeInOut',
      onUpdate: (v) => setFade({ prev: from, t: v }),
      onComplete: () => setFade({ prev: null, t: 1 }),
    })
    return () => controls.stop()
  }, [activeLayer])

  const layers = useMemo(() => {
    const out = []
    if (fade.prev) out.push(...layersFor(fade.prev, hexbins, gaps, 1 - fade.t, false))
    out.push(...layersFor(activeLayer, hexbins, gaps, fade.t, true))
    return out
  }, [hexbins, gaps, activeLayer, fade])

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
      getTooltip: ({ object }) => tooltipFor((object as PickedFeature) ?? null),
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

  // Region fly-to
  useEffect(() => {
    if (!region || !mapRef.current) return
    const [w, s, e, n] = region.bbox
    mapRef.current.fitBounds([w, s, e, n], { padding: 24, duration: 1500, essential: true })
  }, [region])

  return (
    <div className="relative flex-1 overflow-hidden rounded-xl border border-white/[0.06]">
      {/* h-full (not absolute inset-0): maplibre css forces position:relative on this node */}
      <div ref={containerRef} className="h-full w-full" />
      <Legend layerId={activeLayer} />
    </div>
  )
}
