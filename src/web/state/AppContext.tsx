// App-wide state: whether the server is reachable, a fatal problem, and notifications.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Settings } from '../../shared/api.ts'
import { ApiRequestError, api } from '../apiClient.ts'

export type Notification = {
  id: number
  message: string
  /** Shown as copyable text, such as a relogin command. */
  command?: string
  /** Raw details (such as Salesforce's error JSON), shown on demand. */
  details?: unknown
}

type AppState = {
  /** The server's settings; undefined until loaded. */
  settings: Settings | undefined
  setSettings: (settings: Settings) => void
  sessionLost: boolean
  sfNotFound: boolean
  notifications: Notification[]
  notify: (n: Omit<Notification, 'id'>) => void
  dismiss: (id: number) => void
  /**
   * Classifies an API error (docs/web.md "エラーの扱い"). Returns true when the
   * error was handled app-wide, so callers only handle the rest.
   */
  handleCommonError: (e: unknown) => boolean
  /** The settings dialog, opened from the header or from the AI input's notice. */
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
}

const AppContext = createContext<AppState | undefined>(undefined)

let nextId = 1

export function AppProvider({ children }: { children: ReactNode }) {
  const [sessionLost, setSessionLost] = useState(false)
  const [sfNotFound, setSfNotFound] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [settings, setSettings] = useState<Settings>()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const notify = useCallback((n: Omit<Notification, 'id'>) => {
    setNotifications((list) => {
      // The same error from several places (such as describes of one object) is shown once.
      if (list.some((x) => x.message === n.message && x.command === n.command)) return list
      return [...list.slice(-4), { ...n, id: nextId++ }]
    })
  }, [])
  const dismiss = useCallback((id: number) => setNotifications((list) => list.filter((n) => n.id !== id)), [])

  const handleCommonError = useCallback(
    (e: unknown) => {
      if (!(e instanceof ApiRequestError)) {
        notify({ message: (e as Error).message ?? String(e) })
        return true
      }
      if (e.code === 'ABORTED') return true
      if (e.isSessionLost) {
        setSessionLost(true)
        return true
      }
      if (e.code === 'SF_CLI_NOT_FOUND') {
        setSfNotFound(true)
        return true
      }
      return false
    },
    [notify],
  )

  useEffect(() => {
    api.settings().then(setSettings, (e: unknown) => {
      // Without settings, the defaults apply (omit the namespace).
      handleCommonError(e)
    })
  }, [handleCommonError])

  const value = useMemo(
    () => ({ settings, setSettings, sessionLost, sfNotFound, notifications, notify, dismiss, handleCommonError, settingsOpen, setSettingsOpen }),
    [settings, sessionLost, sfNotFound, notifications, notify, dismiss, handleCommonError, settingsOpen],
  )
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// The hook lives next to its provider; this file is not hot-reloaded as a component.
// oxlint-disable-next-line react/only-export-components
export function useApp(): AppState {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside AppProvider')
  return value
}
