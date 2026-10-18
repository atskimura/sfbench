// Which panels of a screen are open (docs/screens.md "パネルの開閉"). Saved
// in localStorage under the screen's own key; without it, every panel starts open.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/** The SOQL screen's (objects, editor, recent) and the REST API screen's (restRequest, restHistory). */
export type PanelName = 'objects' | 'editor' | 'recent' | 'restRequest' | 'restHistory'
type Open = Record<PanelName, boolean>

const ALL_OPEN: Open = { objects: true, editor: true, recent: true, restRequest: true, restHistory: true }

function read(key: string): Open {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Open>
    return { ...ALL_OPEN, ...saved }
  } catch {
    return ALL_OPEN
  }
}

type PanelsValue = { open: Open; setOpen: (name: PanelName, open: boolean) => void }
const PanelsContext = createContext<PanelsValue | undefined>(undefined)

/** `storageKey` is the screen's: the SOQL screen keeps sfbench.panels, as it always has. */
export function PanelsProvider({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  const [open, setOpenState] = useState(() => read(storageKey))
  const setOpen = useCallback((name: PanelName, value: boolean) => {
    setOpenState((prev) => {
      const next = { ...prev, [name]: value }
      try {
        localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        // Only remembering the layout is lost.
      }
      return next
    })
  }, [storageKey])
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
