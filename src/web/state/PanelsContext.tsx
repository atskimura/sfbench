// Which panels of a screen are open (docs/screens.md "パネルの開閉"). Saved
// in localStorage under the screen's own key; without it, every panel starts open.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/** The SOQL screen's (objects, editor, recent), the REST API screen's (restRequest, restHistory) and the Apex screen's (apexEditor, apexHistory). */
export type PanelName = 'objects' | 'editor' | 'recent' | 'restRequest' | 'restHistory' | 'apexEditor' | 'apexHistory'
type Open = Record<PanelName, boolean>

const ALL_OPEN: Open = { objects: true, editor: true, recent: true, restRequest: true, restHistory: true, apexEditor: true, apexHistory: true }

/** The screen's own panels as saved; the others' are not read. */
function read(key: string, names: readonly PanelName[]): Open {
  const open = { ...ALL_OPEN }
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Open>
    for (const name of names) if (typeof saved[name] === 'boolean') open[name] = saved[name]
  } catch {
    // Every panel starts open.
  }
  return open
}

type PanelsValue = { open: Open; setOpen: (name: PanelName, open: boolean) => void }
const PanelsContext = createContext<PanelsValue | undefined>(undefined)

/**
 * `storageKey` is the screen's (the SOQL screen keeps sfbench.panels, as it
 * always has) and `names` its panels: only those are read and saved.
 */
export function PanelsProvider({ storageKey, names, children }: { storageKey: string; names: readonly PanelName[]; children: ReactNode }) {
  const [open, setOpenState] = useState(() => read(storageKey, names))
  const setOpen = useCallback((name: PanelName, value: boolean) => {
    setOpenState((prev) => {
      const next = { ...prev, [name]: value }
      try {
        localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(names.map((n) => [n, next[n]]))))
      } catch {
        // Only remembering the layout is lost.
      }
      return next
    })
    // `names` is a constant array at each screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
