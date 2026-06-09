import { useState, type ReactNode } from 'react'
import { AppStateContext, type LayerId } from './store'

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [regionId, setRegionId] = useState('madison')
  const [activeLayer, setActiveLayer] = useState<LayerId>('density')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  return (
    <AppStateContext.Provider
      value={{ regionId, setRegionId, activeLayer, setActiveLayer, sidebarOpen, setSidebarOpen }}
    >
      {children}
    </AppStateContext.Provider>
  )
}
