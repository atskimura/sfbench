// App-wide state: whether the server is reachable, a fatal problem, and notifications.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Settings, SettingsUpdate } from '../../shared/api.ts'
import { api } from '../apiClient.ts'
import { errorDetails, errorKind, errorMessage } from '../errors.ts'
import { useTask } from './useTask.ts'

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
  /**
   * Saves the settings and applies what the server returns, even if the
   * settings dialog has closed meanwhile. Resolves to whether they were saved.
   */
  saveSettings: (update: SettingsUpdate) => Promise<boolean>
  savingSettings: boolean
  sessionLost: boolean
  sfNotFound: boolean
  notifications: Notification[]
  notify: (n: Omit<Notification, 'id'>) => void
  dismiss: (id: number) => void
  /**
   * Handles the errors shown app-wide: a stopped request, a lost session and a
   * missing sf CLI (docs/web.md "エラーの扱い"). Returns true for those, so
   * callers only handle the rest.
   */
  handleCommonError: (e: unknown) => boolean
  /** Handles an error app-wide, or else notifies it (for a failure with no place of its own). */
  reportError: (e: unknown) => void
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
      const kind = errorKind(e)
      if (kind === 'sessionLost') setSessionLost(true)
      if (kind === 'sfNotFound') setSfNotFound(true)
      return kind === 'aborted' || kind === 'sessionLost' || kind === 'sfNotFound'
    },
    [],
  )
  const reportError = useCallback(
    (e: unknown) => {
      if (!handleCommonError(e)) notify({ message: errorMessage(e), details: errorDetails(e) })
    },
    [handleCommonError, notify],
  )

  // Loading at startup and saving both write the settings, so they share one
  // task here, outside the dialog: a save outlives the dialog (docs/web.md
  // "流れごとの指定"). Its progress marks a save.
  const settingsTask = useTask<'save'>()
  const { start } = settingsTask
  const savingSettings = settingsTask.progress === 'save'

  // Without settings, the defaults apply (omit the namespace), and nothing is
  // shown apart from a lost session or a missing sf CLI.
  useEffect(() => {
    void start((signal) => api.settings(signal), 'ignore').then((outcome) => {
      if (outcome.kind === 'done') setSettings(outcome.value)
      if (outcome.kind === 'error') handleCommonError(outcome.error)
    })
  }, [start, handleCommonError])

  const saveSettings = useCallback(
    async (update: SettingsUpdate) => {
      // Replaces a startup load still running: the saved settings are newer.
      const outcome = await start((signal, progress) => {
        progress('save')
        return api.saveSettings(update, signal)
      }, 'replace')
      if (outcome.kind === 'done') setSettings(outcome.value)
      if (outcome.kind === 'error') reportError(outcome.error)
      return outcome.kind === 'done'
    },
    [start, reportError],
  )

  const value = useMemo(
    () => ({ settings, saveSettings, savingSettings, sessionLost, sfNotFound, notifications, notify, dismiss, handleCommonError, reportError, settingsOpen, setSettingsOpen }),
    [settings, saveSettings, savingSettings, sessionLost, sfNotFound, notifications, notify, dismiss, handleCommonError, reportError, settingsOpen],
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
