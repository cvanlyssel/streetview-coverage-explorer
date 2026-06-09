import { useEffect, useState } from 'react'
import { fetchStats } from './api/client'
import type { RegionStats } from './api/types'

function App() {
  const [stats, setStats] = useState<RegionStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchStats('madison').then(setStats).catch((e: Error) => setError(e.message))
  }, [])

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Street View Coverage Explorer</h1>
        <p className="mt-2 text-sm text-zinc-400">Skeleton ready — UI comes in Step 3.</p>
        {stats && (
          <p className="mt-4 text-sm text-emerald-400">
            Mock API live: {stats.total_samples.toLocaleString()} samples,{' '}
            {stats.coverage_pct}% covered, avg age {stats.avg_age_years}y
          </p>
        )}
        {error && <p className="mt-4 text-sm text-red-400">Mock API error: {error}</p>}
      </div>
    </div>
  )
}

export default App
