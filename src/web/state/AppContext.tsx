// App-wide state: whether the server is reachable, a fatal problem, and notifications.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Settings, SettingsUpdate } from '../../shared/api.ts'
import { api } from '../apiClient.ts'
import { errorDetails, errorKind, errorMessage } from '../errors.ts'
import { t } from '../i18n/i18n.ts'
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
  /** The screen shown: SOQL or REST API (docs/rest.md "モードの置き場所"). */
  mode: Mode
  setMode: (mode: Mode) => void
  /** The settings dialog, opened from the header or from the AI input's notice. */
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  /**
   * How many rows of the result table have changes not saved, and whether a
   * save or delete is being sent (docs/edit.md "保存していない変更を捨てる前の確認").
   */
  setUnsavedEdits: (count: number, sending?: boolean) => void
  /**
   * Runs `action` at once, or after asking whether to throw away the changes
   * not saved. While a save or delete is being sent, does not run it at all:
   * the rows would be sent while the table that shows their outcome goes.
   */
  guardDiscard: (action: () => void) => void
  /** The question guardDiscard is asking, if any. */
  discarding: { count: number } | undefined
  confirmDiscard: () => void
  cancelDiscard: () => void
}

const AppContext = createContext<AppState | undefined>(undefined)

let nextId = 1

export type Mode = 'soql' | 'rest' | 'apex'

const MODE_KEY = 'sfbench.mode'

function readMode(): Mode {
  try {
    const saved = sessionStorage.getItem(MODE_KEY)
    return saved === 'rest' || saved === 'apex' ? saved : 'soql'
  } catch {
    return 'soql'
  }
}

function saveMode(mode: Mode): void {
  try {
    sessionStorage.setItem(MODE_KEY, mode)
  } catch {
    // Only the reload convenience is lost.
  }
}

/** `initialMode` is the launch's (--rest and --apex open their screens); a tab reload keeps the screen it showed. */
export function AppProvider({ initialMode, children }: { initialMode?: Mode; children: ReactNode }) {
  const [sessionLost, setSessionLost] = useState(false)
  const [sfNotFound, setSfNotFound] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [settings, setSettings] = useState<Settings>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mode, setModeState] = useState<Mode>(() => {
    // Saved at once, so that a reload after the launch keeps the screen.
    if (initialMode) saveMode(initialMode)
    return initialMode ?? readMode()
  })
  const setMode = useCallback((next: Mode) => {
    setModeState(next)
    saveMode(next)
  }, [])

  const notify = useCallback((n: Omit<Notification, 'id'>) => {
    setNotifications((list) => {
      // The same error from several places (such as describes of one object) is shown once.
      if (list.some((x) => x.message === n.message && x.command === n.command)) return list
      return [...list.slice(-4), { ...n, id: nextId++ }]
    })
  }, [])
  const dismiss = useCallback((id: number) => setNotifications((list) => list.filter((n) => n.id !== id)), [])

  // Kept in a ref too: guardDiscard reads it when called, not when last drawn.
  // Whether closing the tab asks: changes not saved, or a save or delete still being sent.
  const [unsavedEdits, setUnsavedState] = useState(false)
  const unsaved = useRef({ count: 0, sending: false })
  const setUnsavedEdits = useCallback((count: number, sending = false) => {
    unsaved.current = { count, sending }
    setUnsavedState(count > 0 || sending)
  }, [])
  const [pendingDiscard, setPendingState] = useState<{ count: number; action: () => void }>()
  const pending = useRef(pendingDiscard)
  const setPendingDiscard = useCallback((next: { count: number; action: () => void } | undefined) => {
    pending.current = next
    setPendingState(next)
  }, [])
  const guardDiscard = useCallback(
    (action: () => void) => {
      if (unsaved.current.sending) notify({ message: t.editsSending })
      else if (unsaved.current.count > 0) setPendingDiscard({ count: unsaved.current.count, action })
      else action()
    },
    [setPendingDiscard, notify],
  )
  const confirmDiscard = useCallback(() => {
    const action = pending.current?.action
    setPendingDiscard(undefined)
    action?.()
  }, [setPendingDiscard])
  const cancelDiscard = useCallback(() => setPendingDiscard(undefined), [setPendingDiscard])
  // Closing or reloading the tab asks too, with the browser's own question.
  useEffect(() => {
    if (!unsavedEdits) return
    const ask = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', ask)
    return () => window.removeEventListener('beforeunload', ask)
  }, [unsavedEdits])


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
      // An org's login error is the org context's (handleOrgError), which also marks the org.
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

  const discarding = useMemo(() => (pendingDiscard ? { count: pendingDiscard.count } : undefined), [pendingDiscard])
  const value = useMemo(
    () => ({
      settings,
      saveSettings,
      savingSettings,
      sessionLost,
      sfNotFound,
      notifications,
      notify,
      dismiss,
      handleCommonError,
      reportError,
      mode,
      setMode,
      settingsOpen,
      setSettingsOpen,
      setUnsavedEdits,
      guardDiscard,
      discarding,
      confirmDiscard,
      cancelDiscard,
    }),
    [settings, saveSettings, savingSettings, sessionLost, sfNotFound, notifications, notify, dismiss, handleCommonError, reportError, mode, setMode, settingsOpen, setUnsavedEdits, guardDiscard, discarding, confirmDiscard, cancelDiscard],
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
