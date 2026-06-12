// Left control panel: brand, layer toggles (single active layer), KPI cards.

import { AnimatePresence, motion } from 'framer-motion'
import { routePlanGpxUrl } from '../api/client'
import type { RegionStats, RoutePlan } from '../api/types'
import { LAYERS, useAppState } from '../state/store'
import { CountUp } from './CountUp'

const kpiList = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12 } },
}

const kpiItem = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
}

function Logo() {
  return (
    <div className="flex items-center gap-2 px-4 pt-4">
      <svg viewBox="0 0 28 28" className="h-5 w-5 shrink-0">
        <circle cx="14" cy="14" r="12" fill="none" stroke="#3b82f6" strokeWidth="3" strokeDasharray="44 18" strokeLinecap="round" />
        <circle cx="14" cy="14" r="4.5" fill="#3b82f6" />
      </svg>
      <span className="text-[13px] font-semibold tracking-tight text-white">
        Coverage Explorer
      </span>
    </div>
  )
}

function LayerRows() {
  const { activeLayer, setActiveLayer } = useAppState()
  return (
    <div className="mt-1.5 space-y-0.5">
      {LAYERS.map((layer) => {
        const active = layer.id === activeLayer
        return (
          <button
            key={layer.id}
            type="button"
            onClick={() => setActiveLayer(layer.id)}
            className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              active
                ? 'bg-white/[0.07] font-medium text-white'
                : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
            }`}
          >
            <span>{layer.label}</span>
            {active ? (
              <span className="rounded-full bg-blue-500 px-2 py-px text-[9px] font-bold tracking-wide text-white">
                ON
              </span>
            ) : (
              <span className="h-3.5 w-6 rounded-full bg-zinc-700 p-0.5">
                <span className="block h-2.5 w-2.5 rounded-full bg-zinc-500" />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function KpiCard({
  label,
  value,
  format,
  sub,
  badge,
}: {
  label: string
  value: number
  format: (n: number) => string
  sub?: string
  badge?: string
}) {
  return (
    <motion.div
      variants={kpiItem}
      className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-400">{label}</span>
        {badge && <span className="text-[10px] font-semibold text-blue-400">{badge}</span>}
      </div>
      <div className="mt-0.5 text-lg font-bold leading-tight tracking-tight text-white">
        <CountUp value={value} format={format} />
      </div>
      {sub && <div className="text-[11px] text-zinc-400">{sub}</div>}
    </motion.div>
  )
}

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60)
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`
}

// Feature-flagged Gap Route overlay: toggle row + stats card (ROUTE_PLANNER.md)
function RoutePanel({ plan }: { plan: RoutePlan }) {
  const { routeVisible, setRouteVisible } = useAppState()
  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={() => setRouteVisible(!routeVisible)}
        className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
          routeVisible
            ? 'bg-white/[0.07] font-medium text-white'
            : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
        }`}
      >
        <span>Gap Route</span>
        {routeVisible ? (
          <span className="rounded-full bg-emerald-500 px-2 py-px text-[9px] font-bold tracking-wide text-white">
            ON
          </span>
        ) : (
          <span className="h-3.5 w-6 rounded-full bg-zinc-700 p-0.5">
            <span className="block h-2.5 w-2.5 rounded-full bg-zinc-500" />
          </span>
        )}
      </button>
      {routeVisible && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5"
        >
          <div className="text-[11px] text-zinc-400">
            {plan.n_stops} stops · {plan.total_km.toFixed(1)} km
          </div>
          <div className="mt-0.5 text-sm font-bold text-white">
            ~{formatMinutes(plan.est_minutes)} {plan.mode}
          </div>
          <a
            href={routePlanGpxUrl(plan.region, plan.mode)}
            className="mt-2 block rounded-md bg-emerald-600 px-2 py-1.5 text-center text-[11px] font-semibold text-white transition-colors hover:bg-emerald-500"
            download
          >
            Download GPX
          </a>
        </motion.div>
      )}
    </div>
  )
}

export function Sidebar({
  stats,
  routePlan,
}: {
  stats: RegionStats | null
  routePlan: RoutePlan | null
}) {
  const { sidebarOpen, setSidebarOpen } = useAppState()

  return (
    <AnimatePresence initial={false}>
      {sidebarOpen && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 200, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          className="shrink-0 overflow-hidden border-r border-white/[0.06] bg-black/20"
        >
          <div className="flex h-full w-[200px] flex-col">
            <Logo />

            <div className="flex-1 overflow-y-auto px-2.5 pb-4 pt-5">
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="flex w-full items-center justify-between px-1.5 pb-1 text-xs font-semibold text-zinc-300 hover:text-white"
              >
                Filters
                <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3 stroke-zinc-500">
                  <path d="m4 10 4-4 4 4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              <LayerRows />

              {routePlan && <RoutePanel plan={routePlan} />}

              <div className="mt-5 px-1.5 pb-1.5 text-xs font-semibold text-zinc-300">KPI</div>
              {stats && (
                <motion.div
                  variants={kpiList}
                  initial="hidden"
                  animate="show"
                  className="space-y-2 px-0.5"
                >
                  <KpiCard
                    label="Samples"
                    value={stats.total_samples}
                    format={(n) => Math.round(n).toLocaleString()}
                    sub="Locations"
                  />
                  <KpiCard
                    label="Coverage"
                    value={stats.coverage_pct}
                    format={(n) => `${n.toFixed(1)}%`}
                    badge="LIVE"
                  />
                  <KpiCard
                    label="Avg Age"
                    value={stats.avg_age_years}
                    format={(n) => `${n.toFixed(1)} yrs`}
                  />
                </motion.div>
              )}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
