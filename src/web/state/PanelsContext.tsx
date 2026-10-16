// Which panels of the SOQL screen are open (docs/screens.md "パネルの開閉").
// Saved in localStorage; without it, every panel starts open.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type PanelName = 'objects' | 'editor' | 'recent'
type Open = Record<PanelName, boolean>

const KEY = 'sfbench.panels'
const ALL_OPEN: Open = { objects: true, editor: true, recent: true }

function read(): Open {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Open>
    return { ...ALL_OPEN, ...saved }
  } catch {
    return ALL_OPEN
  }
}

type PanelsValue = { open: Open; setOpen: (name: PanelName, open: boolean) => void }
const PanelsContext = createContext<PanelsValue | undefined>(undefined)

export function PanelsProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(read)
  const setOpen = useCallback((name: PanelName, value: boolean) => {
    setOpenState((prev) => {
      const next = { ...prev, [name]: value }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // Only remembering the layout is lost.
      }
      return next
    })
  }, [])
  const value = useMemo(() => ({ open, setOpen }), [open, setOpen])
  return <PanelsContext.Provider value={value}>{children}</PanelsContext.Provider>
}

// The hook lives next to its provider; this file is not hot-reloaded as a component.
// oxlint-disable-next-line react/only-export-components
export function usePanels(): PanelsValue {
  const value = useContext(PanelsContext)
  if (!value) throw new Error('usePanels must be used inside PanelsProvider')
  return value
}
