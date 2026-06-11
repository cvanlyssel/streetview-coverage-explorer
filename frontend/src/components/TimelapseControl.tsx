// Floating scrubber for the time-lapse layer: play button, per-year histogram,
// and a fractional-year slider. The play loop advances the year via rAF; the
// GPU filter in MapPanel makes per-frame updates cheap.

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { AgeHistogramBin } from '../api/types'
import { ageColor } from '../lib/colors'

const PLAY_YEARS_PER_SECOND = 2.2
const NOW_YEAR = new Date().getFullYear()

function HistogramBars({
  bins,
  minYear,
  maxYear,
  year,
}: {
  bins: AgeHistogramBin[]
  minYear: number
  maxYear: number
  year: number
}) {
  const byYear = new Map(bins.map((b) => [b.year, b.count]))
  const max = Math.max(1, ...bins.map((b) => b.count))
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i)
  return (
    <div className="flex h-4 items-end gap-px">
      {years.map((y) => {
        const count = byYear.get(y) ?? 0
        // sqrt scale: one dominant recapture year would otherwise flatten the rest
        const h = Math.max(count > 0 ? 8 : 4, Math.round(100 * Math.sqrt(count / max)))
        const reached = y <= year
        return (
          <div
            key={y}
            className="flex-1 rounded-sm transition-colors duration-150"
            style={{
              height: `${h}%`,
              background: reached ? `rgb(${ageColor(NOW_YEAR - y).join(',')})` : '#3f3f46',
              opacity: reached ? 1 : 0.6,
            }}
            title={`${y}: ${count.toLocaleString()} panoramas`}
          />
        )
      })}
    </div>
  )
}

export function TimelapseControl({
  minYear,
  maxYear,
  year,
  onYearChange,
  histogram,
  loading,
}: {
  minYear: number
  maxYear: number
  year: number
  onYearChange: (year: number) => void
  histogram: AgeHistogramBin[]
  loading: boolean
}) {
  const [playing, setPlaying] = useState(false)
  const yearRef = useRef(year)
  useEffect(() => {
    yearRef.current = year
  }, [year])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const next = Math.min(maxYear, yearRef.current + dt * PLAY_YEARS_PER_SECOND)
      onYearChange(next)
      if (next >= maxYear) {
        setPlaying(false)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, maxYear, onYearChange])

  const togglePlay = () => {
    if (!playing && year >= maxYear - 0.05) onYearChange(minYear)
    setPlaying((p) => !p)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.18 }}
      className="pointer-events-auto absolute bottom-7 left-1/2 z-10 -translate-x-1/2 rounded-md border border-white/10 bg-[#14161c]/90 px-3 py-2 backdrop-blur"
    >
      {loading ? (
        <div className="flex h-10 w-72 items-center justify-center gap-2 text-[11px] text-zinc-400">
          <span className="h-3 w-3 animate-spin rounded-full border border-zinc-500 border-t-transparent" />
          Loading sample points…
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white transition-colors hover:bg-blue-400"
          >
            {playing ? (
              <svg viewBox="0 0 16 16" className="h-3 w-3 fill-current">
                <rect x="3.5" y="3" width="3.2" height="10" rx="1" />
                <rect x="9.3" y="3" width="3.2" height="10" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" className="ml-0.5 h-3 w-3 fill-current">
                <path d="M4.5 3.2a1 1 0 0 1 1.53-.85l7 4.8a1 1 0 0 1 0 1.7l-7 4.8a1 1 0 0 1-1.53-.85V3.2Z" />
              </svg>
            )}
          </button>

          <div className="w-64">
            <HistogramBars bins={histogram} minYear={minYear} maxYear={maxYear} year={year} />
            <input
              type="range"
              min={minYear}
              max={maxYear}
              step={1 / 12}
              value={year}
              onChange={(e) => {
                setPlaying(false)
                onYearChange(Number(e.target.value))
              }}
              aria-label="Capture year"
              className="mt-1 block h-1 w-full accent-blue-500"
            />
            <div className="flex justify-between text-[9px] text-zinc-500">
              <span>{minYear}</span>
              <span>{maxYear}</span>
            </div>
          </div>

          <div className="w-11 text-right text-base font-bold tabular-nums tracking-tight text-white">
            {Math.floor(year)}
          </div>
        </div>
      )}
    </motion.div>
  )
}
