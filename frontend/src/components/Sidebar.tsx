// Left control panel: brand, layer toggles (single active layer), KPI cards.

import { AnimatePresence, motion } from 'framer-motion'
import type { RegionStats } from '../api/types'
import { LAYERS, useAppState } from '../state/store'

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
  sub,
  badge,
}: {
  label: string
  value: string
  sub?: string
  badge?: string
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-400">{label}</span>
        {badge && <span className="text-[10px] font-semibold text-blue-400">{badge}</span>}
      </div>
      <div className="mt-0.5 text-lg font-bold leading-tight tracking-tight text-white">
        {value}
      </div>
      {sub && <div className="text-[11px] text-zinc-400">{sub}</div>}
    </div>
  )
}

export function Sidebar({ stats }: { stats: RegionStats | null }) {
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

              <div className="mt-5 px-1.5 pb-1.5 text-xs font-semibold text-zinc-300">KPI</div>
              <div className="space-y-2 px-0.5">
                <KpiCard
                  label="Samples"
                  value={stats ? stats.total_samples.toLocaleString() : '—'}
                  sub="Locations"
                />
                <KpiCard
                  label="Coverage"
                  value={stats ? `${stats.coverage_pct}%` : '—'}
                  badge="LIVE"
                />
                <KpiCard
                  label="Avg Age"
                  value={stats ? `${stats.avg_age_years} yrs` : '—'}
                />
              </div>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
