// Single home for map/UI state per CLAUDE.md: active layer, region, panel visibility.

import { createContext, useContext } from 'react'

export type LayerId = 'density' | 'age' | 'official' | 'gaps' | 'timelapse'

export const LAYERS: { id: LayerId; label: string }[] = [
  { id: 'density', label: 'Density' },
  { id: 'age', label: 'Coverage Age' },
  { id: 'official', label: 'Official vs Unofficial' },
  { id: 'gaps', label: 'Coverage Gaps' },
  { id: 'timelapse', label: 'Time-lapse' },
]

export interface AppState {
  regionId: string
  setRegionId: (id: string) => void
  activeLayer: LayerId
  setActiveLayer: (layer: LayerId) => void
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
}

export const AppStateContext = createContext<AppState | null>(null)

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider')
  return ctx
}
