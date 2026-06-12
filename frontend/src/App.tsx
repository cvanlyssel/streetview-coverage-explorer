import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  FEATURE_ROUTE_PLANNER,
  fetchGaps,
  fetchHexbins,
  fetchPoints,
  fetchRegions,
  fetchRoutePlan,
  fetchStats,
} from './api/client'
import type {
  GapCollection,
  HexbinCollection,
  PointCollection,
  Region,
  RegionStats,
  RoutePlan,
} from './api/types'
import { DetailsPanel } from './components/DetailsPanel'
import { GlobeLanding } from './components/GlobeLanding'
import { MapPanel } from './components/MapPanel'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { AppStateProvider } from './state/AppState'
import { useAppState } from './state/store'

function RegionChip({ regions }: { regions: Region[] }) {
  const { regionId, setRegionId } = useAppState()
  const current = regions.find((r) => r.id === regionId)
  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <select
          value={regionId}
          onChange={(e) => setRegionId(e.target.value)}
          className="h-7 appearance-none rounded-md border border-white/10 bg-white/[0.05] pl-7 pr-7 text-xs font-medium text-zinc-200 outline-none hover:bg-white/[0.08]"
          aria-label="Region"
        >
          {regions.map((r) => (
            <option key={r.id} value={r.id} className="bg-zinc-900">
              {r.name}
            </option>
          ))}
        </select>
        <svg
          viewBox="0 0 16 16"
          fill="none"
          className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 stroke-zinc-400"
        >
          <path
            d="M8 14s4.5-3.6 4.5-7A4.5 4.5 0 0 0 3.5 7c0 3.4 4.5 7 4.5 7Z"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <circle cx="8" cy="7" r="1.6" strokeWidth="1.4" />
        </svg>
        <svg
          viewBox="0 0 16 16"
          fill="none"
          className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 stroke-zinc-400"
        >
          <path d="m4 6 4 4 4-4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {current && (
        <span className="hidden text-[10px] text-zinc-500 xl:block">
          Updated {current.last_updated}
        </span>
      )}
    </div>
  )
}

function Shell() {
  const { regionId, activeLayer, sidebarOpen, setSidebarOpen } = useAppState()
  const [regions, setRegions] = useState<Region[]>([])
  const [stats, setStats] = useState<RegionStats | null>(null)
  const [hexbins, setHexbins] = useState<HexbinCollection | null>(null)
  const [gaps, setGaps] = useState<GapCollection | null>(null)
  // Keyed by region so a region switch invalidates without a reset effect.
  const [pointsCache, setPointsCache] = useState<{
    regionId: string
    data: PointCollection
  } | null>(null)
  const points = pointsCache?.regionId === regionId ? pointsCache.data : null

  useEffect(() => {
    fetchRegions().then(setRegions).catch(console.error)
  }, [])

  // Keyed by region: null plan = endpoint said "not planned" for this region.
  const [routeCache, setRouteCache] = useState<{
    regionId: string
    plan: RoutePlan | null
  } | null>(null)
  const routePlan = routeCache?.regionId === regionId ? routeCache.plan : null

  useEffect(() => {
    fetchStats(regionId).then(setStats).catch(console.error)
    fetchHexbins(regionId).then(setHexbins).catch(console.error)
    fetchGaps(regionId).then(setGaps).catch(console.error)
    if (FEATURE_ROUTE_PLANNER) {
      fetchRoutePlan(regionId)
        .then((plan) => setRouteCache({ regionId, plan }))
        .catch(console.error)
    }
  }, [regionId])

  // Per-point data is heavy (10s of MB for a full region), so it loads only
  // once the time-lapse layer is opened, then sticks for the region.
  useEffect(() => {
    if (activeLayer !== 'timelapse' || points) return
    let stale = false
    fetchPoints(regionId)
      .then((data) => {
        if (!stale) setPointsCache({ regionId, data })
      })
      .catch(console.error)
    return () => {
      stale = true
    }
  }, [activeLayer, regionId, points])

  const region = regions.find((r) => r.id === regionId) ?? null

  return (
    <div className="h-full bg-[#c8ccd6] p-3 lg:p-4">
      <div className="flex h-full overflow-hidden rounded-xl bg-[#14161c] shadow-2xl shadow-black/40">
        <Sidebar stats={stats} routePlan={routePlan} />

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />

          <main className="flex min-h-0 flex-1 flex-col px-4 pb-4">
            <div className="flex h-12 shrink-0 items-center justify-between">
              <div className="flex items-center gap-2.5">
                {!sidebarOpen && (
                  <button
                    type="button"
                    onClick={() => setSidebarOpen(true)}
                    aria-label="Open panel"
                    className="rounded-md border border-white/10 p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white"
                  >
                    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 stroke-current">
                      <path d="M2 4h12M2 8h12M2 12h12" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
                <h1 className="text-base font-bold tracking-tight text-white">Layers</h1>
              </div>
              <RegionChip regions={regions} />
            </div>

            <div className="flex min-h-0 flex-1 gap-3">
              <MapPanel
                region={region}
                hexbins={hexbins}
                gaps={gaps}
                points={points}
                stats={stats}
                routePlan={routePlan}
              />
              <DetailsPanel stats={stats} />
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

// Globe first, explorer after a marker click (or skip). Entry is plain local
// navigation state; the store keeps only what the explorer itself uses.
function Root() {
  const { setRegionId } = useAppState()
  const [entered, setEntered] = useState(false)

  if (!entered) {
    return (
      <GlobeLanding
        onEnter={(regionId) => {
          if (regionId) setRegionId(regionId)
          setEntered(true)
        }}
      />
    )
  }
  return (
    <motion.div
      className="h-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <Shell />
    </motion.div>
  )
}

function App() {
  return (
    <AppStateProvider>
      <Root />
    </AppStateProvider>
  )
}

export default App
