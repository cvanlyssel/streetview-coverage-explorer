// Central map: MapLibre dark basemap with the active deck.gl data layer on top.
// Layer switches cross-fade by rendering the outgoing and incoming layers
// together while a framer-motion tween drives their opacities.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import { HeatmapLayer } from '@deck.gl/aggregation-layers'
import { DataFilterExtension, type DataFilterExtensionProps } from '@deck.gl/extensions'
import { animate, AnimatePresence, motion } from 'framer-motion'
import type {
  Feature,
  GapCollection,
  GapProperties,
  HexbinCollection,
  HexbinProperties,
  PointCollection,
  PointGeometry,
  PolygonGeometry,
  Region,
  RegionStats,
} from '../api/types'
import {
  AGE_GRADIENT_CSS,
  CAPTURE_YEAR_GRADIENT_CSS,
  GAP_COLOR,
  HEAT_COLOR_RANGE,
  HEAT_GRADIENT_CSS,
  OFFICIAL_GRADIENT_CSS,
  type RGB,
  ageColor,
  officialColor,
} from '../lib/colors'
import { useAppState, type LayerId } from '../state/store'
import { TimelapseControl } from './TimelapseControl'

const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

type HexFeature = Feature<PolygonGeometry, HexbinProperties>
type GapPointFeature = Feature<PointGeometry, GapProperties>

// Flat per-pano rows for the time-lapse: fractional capture year for the GPU
// filter, precomputed color so accessors stay trivial at 100k+ points.
interface TimelapsePoint {
  position: [number, number]
  year: number
  date: string
  source: string
  color: RGB
}

interface TimelapseState {
  data: TimelapsePoint[] | null
  year: number
  minYear: number
}

type PickedFeature = HexFeature | GapPointFeature | TimelapsePoint

const NOW_YEAR = new Date().getFullYear()

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
  timelapse: TimelapseState,
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
          // Tuned for real res-10 hexbins (~114 m cell spacing): tighter radius
          // keeps individual road corridors legible instead of merging into halo.
          radiusPixels: 24,
          intensity: 1.25,
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
    case 'timelapse':
      if (!timelapse.data) return []
      return [
        new ScatterplotLayer<TimelapsePoint, DataFilterExtensionProps<TimelapsePoint>>({
          id: 'timelapse-points',
          data: timelapse.data,
          getPosition: (d) => d.position,
          getFillColor: (d) => [...d.color, 210],
          radiusMinPixels: 1.8,
          radiusMaxPixels: 5,
          pickable,
          opacity,
          // Cumulative reveal on the GPU: scrubbing/playing only changes
          // filterRange, so no per-frame re-upload of 50k+ points.
          extensions: [new DataFilterExtension({ filterSize: 1 })],
          getFilterValue: (d) => d.year,
          filterRange: [timelapse.minYear - 1, timelapse.year + 0.001],
        }),
      ]
  }
}

function tooltipFor(object: PickedFeature | null) {
  if (!object) return null
  if ('year' in object) {
    return {
      html: `
        <div style="font-weight:600;margin-bottom:2px">Captured ${object.date}</div>
        <div style="color:#9ca3af">${object.source === 'google' ? 'Google car/trekker' : 'User photosphere'}</div>
      `,
      style: TOOLTIP_STYLE,
    }
  }
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
  return { html, style: TOOLTIP_STYLE }
}

const TOOLTIP_STYLE = {
  background: 'rgba(20,22,28,0.95)',
  color: '#e5e7eb',
  fontSize: '12px',
  borderRadius: '8px',
  padding: '8px 10px',
  border: '1px solid rgba(255,255,255,0.1)',
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
  timelapse: {
    title: 'Capture year',
    gradient: CAPTURE_YEAR_GRADIENT_CSS,
    left: 'Older',
    right: 'Newer',
  },
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
  points,
  stats,
}: {
  region: Region | null
  hexbins: HexbinCollection | null
  gaps: GapCollection | null
  points: PointCollection | null
  stats: RegionStats | null
}) {
  const { activeLayer } = useAppState()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)

  // Cross-fade: prev holds the outgoing layer until the tween finishes
  const [fade, setFade] = useState<{ prev: LayerId | null; t: number }>({ prev: null, t: 1 })
  const shownLayerRef = useRef(activeLayer)

  const yearRange = useMemo<[number, number] | null>(() => {
    if (!stats || stats.oldest_date.length < 4 || stats.newest_date.length < 4) return null
    return [Number(stats.oldest_date.slice(0, 4)), Number(stats.newest_date.slice(0, 4))]
  }, [stats])

  // Time-lapse year is ephemeral animation state (like `fade`), so it stays
  // local instead of in the app store: play advances it every rAF frame.
  // Keying the override by region makes a region switch fall back to the
  // default (fully revealed) without a reset effect.
  const [yearOverride, setYearOverride] = useState<{ key: string; year: number } | null>(null)
  const domainKey = stats?.region ?? ''
  const timelapseYear = yearOverride?.key === domainKey ? yearOverride.year : (yearRange?.[1] ?? null)
  const setTimelapseYear = useCallback(
    (year: number) => setYearOverride({ key: domainKey, year }),
    [domainKey],
  )

  const timelapseData = useMemo<TimelapsePoint[] | null>(() => {
    if (!points) return null
    const rows: TimelapsePoint[] = []
    for (const f of points.features) {
      const p = f.properties
      if (p.status !== 'OK' || p.date.length < 7) continue
      const year = Number(p.date.slice(0, 4)) + (Number(p.date.slice(5, 7)) - 1) / 12
      rows.push({
        position: f.geometry.coordinates,
        year,
        date: p.date,
        source: p.source,
        color: ageColor(NOW_YEAR - year),
      })
    }
    return rows
  }, [points])

  const timelapse = useMemo<TimelapseState>(
    () => ({
      data: timelapseData,
      year: timelapseYear ?? yearRange?.[1] ?? NOW_YEAR,
      minYear: yearRange?.[0] ?? 2007,
    }),
    [timelapseData, timelapseYear, yearRange],
  )

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
    if (fade.prev) out.push(...layersFor(fade.prev, hexbins, gaps, timelapse, 1 - fade.t, false))
    out.push(...layersFor(activeLayer, hexbins, gaps, timelapse, fade.t, true))
    return out
  }, [hexbins, gaps, timelapse, activeLayer, fade])

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
      <AnimatePresence>
        {activeLayer === 'timelapse' && yearRange && stats && (
          <TimelapseControl
            key="timelapse-control"
            minYear={yearRange[0]}
            maxYear={yearRange[1]}
            year={timelapse.year}
            onYearChange={setTimelapseYear}
            histogram={stats.age_histogram}
            loading={!timelapseData}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
