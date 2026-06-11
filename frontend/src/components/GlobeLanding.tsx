// Landing page: a deck.gl globe choropleth of country-level Street View
// coverage (static dataset in lib/svCoverage.ts), with pulsing markers on the
// regions we actually measured. Clicking a marker flies the camera down, then
// hands off to the explorer with that region selected.

import { useEffect, useMemo, useRef, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { _GlobeView as GlobeView } from '@deck.gl/core'
import { GeoJsonLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers'
import { motion } from 'framer-motion'
import { fetchRegions } from '../api/client'
import type { Region } from '../api/types'
import countriesRaw from '../assets/ne_countries_110m.json'
import {
  CLASS_COLORS,
  CLASS_LABELS,
  coverageClass,
  type CoverageClass,
} from '../lib/svCoverage'
import type { FeatureCollection, Geometry } from 'geojson'

interface CountryProps {
  a3: string
  name: string
}

const COUNTRIES = countriesRaw as unknown as FeatureCollection<Geometry, CountryProps>

interface RegionMarker {
  id: string
  name: string
  position: [number, number]
}

interface GlobeViewState {
  longitude: number
  latitude: number
  zoom: number
}

const INITIAL_VIEW: GlobeViewState = { longitude: -89.5, latitude: 38, zoom: 1.3 }
const SPIN_DEG_PER_S = 1.6
const FLY_MS = 1600

// Whole-sphere polygon: in GlobeView this renders as the ocean ball.
const SPHERE = [
  { polygon: [[-180, 89.9], [0, 89.9], [180, 89.9], [180, -89.9], [0, -89.9], [-180, -89.9]] },
]

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

export function GlobeLanding({ onEnter }: { onEnter: (regionId?: string) => void }) {
  const [viewState, setViewState] = useState<GlobeViewState>(INITIAL_VIEW)
  const [regions, setRegions] = useState<Region[]>([])
  const [clock, setClock] = useState(0)
  // Click sets the target; the effect below owns the camera animation.
  const [flyTarget, setFlyTarget] = useState<RegionMarker | null>(null)
  const interactedRef = useRef(false)
  const flyingRef = useRef(false)
  const viewRef = useRef(viewState)
  useEffect(() => {
    viewRef.current = viewState
  }, [viewState])

  useEffect(() => {
    fetchRegions().then(setRegions).catch(console.error)
  }, [])

  // One rAF clock drives both the idle spin and the marker pulse.
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setClock(now / 1000)
      if (!interactedRef.current && !flyingRef.current) {
        setViewState((v) => ({ ...v, longitude: v.longitude - dt * SPIN_DEG_PER_S }))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const markers = useMemo<RegionMarker[]>(
    () =>
      regions.map((r) => ({
        id: r.id,
        name: r.name,
        position: [(r.bbox[0] + r.bbox[2]) / 2, (r.bbox[1] + r.bbox[3]) / 2],
      })),
    [regions],
  )

  useEffect(() => {
    if (!flyTarget || flyingRef.current) return
    flyingRef.current = true
    const from = { ...viewRef.current }
    // Approach from the current spin longitude via the short way around
    let dLng = flyTarget.position[0] - from.longitude
    dLng = ((dLng % 360) + 540) % 360 - 180
    let raf = 0
    let start = 0
    const step = (now: number) => {
      if (!start) start = now
      const t = Math.min(1, (now - start) / FLY_MS)
      const e = easeInOutCubic(t)
      setViewState({
        longitude: from.longitude + dLng * e,
        latitude: from.latitude + (flyTarget.position[1] - from.latitude) * e,
        zoom: from.zoom + (5.5 - from.zoom) * e,
      })
      if (t < 1) {
        raf = requestAnimationFrame(step)
      } else {
        onEnter(flyTarget.id)
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [flyTarget, onEnter])

  const pulse = (Math.sin(clock * 2.5) + 1) / 2 // 0..1

  const layers = [
    new SolidPolygonLayer({
      id: 'ocean',
      data: SPHERE, // default getPolygon reads d.polygon
      getFillColor: [13, 18, 30, 255],
    }),
    new GeoJsonLayer<CountryProps>({
      id: 'countries',
      data: COUNTRIES,
      getFillColor: (f) => {
        const c = CLASS_COLORS[coverageClass(f.properties.a3)]
        return [c[0], c[1], c[2], coverageClass(f.properties.a3) === 'none' ? 160 : 210]
      },
      getLineColor: [10, 14, 22, 255],
      lineWidthMinPixels: 1,
      stroked: true,
      filled: true,
      pickable: true,
    }),
    new ScatterplotLayer<RegionMarker>({
      id: 'region-pulse',
      data: markers,
      getPosition: (d) => d.position,
      radiusUnits: 'pixels',
      getRadius: 10 + pulse * 14,
      getFillColor: [96, 165, 250, Math.round(90 * (1 - pulse))],
      updateTriggers: { getRadius: pulse, getFillColor: pulse },
    }),
    new ScatterplotLayer<RegionMarker>({
      id: 'region-dots',
      data: markers,
      getPosition: (d) => d.position,
      radiusUnits: 'pixels',
      getRadius: 6,
      getFillColor: [219, 234, 254, 255],
      getLineColor: [59, 130, 246, 255],
      lineWidthMinPixels: 2,
      stroked: true,
      pickable: true,
      onClick: ({ object }) => {
        if (object) setFlyTarget(object)
        return true
      },
    }),
  ]
  // (No TextLayer labels: billboarded text is a known GlobeView limitation,
  // so region names live in the HTML panel below instead.)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="relative h-full overflow-hidden bg-[#05070c]"
      style={{
        background:
          'radial-gradient(ellipse 60% 55% at 50% 48%, #101726 0%, #05070c 65%)',
      }}
    >
      <DeckGL
        views={new GlobeView({ resolution: 10 })}
        viewState={viewState}
        onViewStateChange={({ viewState: v, interactionState }) => {
          if (interactionState?.isDragging) interactedRef.current = true
          if (!flyingRef.current) {
            const gv = v as unknown as GlobeViewState
            setViewState({ longitude: gv.longitude, latitude: gv.latitude, zoom: gv.zoom })
          }
        }}
        controller={{ keyboard: false }}
        layers={layers}
        getTooltip={({ object }) => {
          if (!object || !('properties' in object)) return null
          const f = object as { properties: CountryProps }
          const cls: CoverageClass = coverageClass(f.properties.a3)
          return {
            html: `<div style="font-weight:600">${f.properties.name}</div>
                   <div style="color:#9ca3af">${CLASS_LABELS[cls]}</div>`,
            style: {
              background: 'rgba(20,22,28,0.95)',
              color: '#e5e7eb',
              fontSize: '12px',
              borderRadius: '8px',
              padding: '8px 10px',
              border: '1px solid rgba(255,255,255,0.1)',
            },
          }
        }}
      />

      {/* Title block */}
      <div className="pointer-events-none absolute left-8 top-8 z-10 max-w-md">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 28 28" className="h-7 w-7 shrink-0">
            <circle cx="14" cy="14" r="12" fill="none" stroke="#3b82f6" strokeWidth="3" strokeDasharray="44 18" strokeLinecap="round" />
            <circle cx="14" cy="14" r="4.5" fill="#3b82f6" />
          </svg>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Street View Coverage Explorer
          </h1>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          Where Google's cameras have been — and where they haven't. Country-level
          coverage worldwide; street-level measurements where we've run the pipeline.
        </p>
      </div>

      {/* Coverage legend */}
      <div className="pointer-events-none absolute bottom-8 left-8 z-10 rounded-md border border-white/10 bg-[#14161c]/90 px-3.5 py-3 backdrop-blur">
        <div className="text-[11px] font-medium text-zinc-300">Street View coverage</div>
        <div className="mt-2 space-y-1.5">
          {(Object.keys(CLASS_LABELS) as CoverageClass[]).map((cls) => (
            <div key={cls} className="flex items-center gap-2 text-[10px] text-zinc-400">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ background: `rgb(${CLASS_COLORS[cls].join(',')})` }}
              />
              {CLASS_LABELS[cls]}
            </div>
          ))}
        </div>
        <div className="mt-2.5 border-t border-white/10 pt-2 text-[9px] text-zinc-500">
          Approximate; compiled June 2026
        </div>
      </div>

      {/* Hint + enter */}
      <div className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 text-center">
        <div className="text-[11px] text-zinc-500">
          Drag to spin · Click a marker to dive into the data
        </div>
      </div>
      <button
        type="button"
        onClick={() => onEnter()}
        className="absolute right-8 top-8 z-10 rounded-md border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-medium text-zinc-200 backdrop-blur transition-colors hover:bg-white/[0.1] hover:text-white"
      >
        Skip to explorer →
      </button>

      {/* Measured regions: clickable, mirrors the pulsing globe markers */}
      {markers.length > 0 && (
        <div className="absolute bottom-8 right-8 z-10 rounded-md border border-white/10 bg-[#14161c]/90 px-3.5 py-3 backdrop-blur">
          <div className="text-[11px] font-medium text-zinc-300">
            Street-level data — dive in
          </div>
          <div className="mt-2 space-y-1">
            {markers.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setFlyTarget(m)}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-300" />
                </span>
                {m.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  )
}
