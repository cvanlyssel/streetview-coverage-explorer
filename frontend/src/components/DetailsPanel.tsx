// Right column: tabbed details card with the imagery-age histogram and a stats table.

import { useState } from 'react'
import type { RegionStats } from '../api/types'

type Tab = 'details' | 'stats'

function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'details', label: 'Details' },
    { id: 'stats', label: 'Stats' },
  ]
  return (
    <div className="flex gap-4 border-b border-white/[0.06] px-3">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTab(t.id)}
          className={`relative py-2 text-xs font-medium transition-colors ${
            tab === t.id ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {t.label}
          {tab === t.id && (
            <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-blue-500" />
          )}
        </button>
      ))}
    </div>
  )
}

function AgeHistogram({ stats }: { stats: RegionStats }) {
  const bins = stats.age_histogram
  const max = Math.max(...bins.map((b) => b.count))
  return (
    <div className="px-3 pb-3 pt-2.5">
      <div className="text-[11px] font-medium text-zinc-300">Imagery by capture year</div>
      <div className="mt-2 flex h-20 items-end gap-[2px]">
        {bins.map((b) => (
          <div
            key={b.year}
            title={`${b.year}: ${b.count.toLocaleString()}`}
            className="flex-1 rounded-t-[2px] bg-blue-500/80 transition-colors hover:bg-blue-400"
            style={{ height: `${Math.max(3, (b.count / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-zinc-500">
        <span>{bins[0]?.year}</span>
        <span>{bins[bins.length - 1]?.year}</span>
      </div>
    </div>
  )
}

function DetailRows({ stats }: { stats: RegionStats }) {
  const rows: [string, string][] = [
    ['Covered', stats.covered.toLocaleString()],
    ['Coverage', `${stats.coverage_pct}%`],
    ['Official', `${stats.official_pct}%`],
    ['Avg age', `${stats.avg_age_years} yrs`],
    ['Oldest', stats.oldest_date],
    ['Newest', stats.newest_date],
  ]
  return (
    <div className="px-3 py-1.5">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="flex items-center justify-between border-b border-white/[0.04] py-1.5 text-xs last:border-0"
        >
          <span className="text-zinc-400">{label}</span>
          <span className="font-medium text-zinc-100">{value}</span>
        </div>
      ))}
    </div>
  )
}

function TopYears({ stats }: { stats: RegionStats }) {
  const top = [...stats.age_histogram].sort((a, b) => b.count - a.count).slice(0, 5)
  const total = stats.age_histogram.reduce((s, b) => s + b.count, 0)
  return (
    <div className="px-3 py-1.5">
      {top.map((b) => (
        <div
          key={b.year}
          className="flex items-center justify-between border-b border-white/[0.04] py-1.5 text-xs last:border-0"
        >
          <span className="text-zinc-400">{b.year}</span>
          <span className="text-zinc-300">{b.count.toLocaleString()}</span>
          <span className="font-medium text-zinc-100">{((b.count / total) * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  )
}

export function DetailsPanel({ stats }: { stats: RegionStats | null }) {
  const [tab, setTab] = useState<Tab>('details')

  return (
    <aside className="flex w-[236px] shrink-0 flex-col gap-3">
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02]">
        <TabBar tab={tab} setTab={setTab} />
        {stats ? (
          <AgeHistogram stats={stats} />
        ) : (
          <div className="p-3 text-xs text-zinc-500">Loading…</div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto rounded-lg border border-white/[0.06] bg-white/[0.02]">
        <div className="border-b border-white/[0.06] px-3 py-2 text-xs font-semibold text-white">
          {tab === 'details' ? 'Region details' : 'Top capture years'}
        </div>
        {stats &&
          (tab === 'details' ? <DetailRows stats={stats} /> : <TopYears stats={stats} />)}
      </div>
    </aside>
  )
}
