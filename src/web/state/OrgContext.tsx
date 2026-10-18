// The org list and the selected org. See docs/web.md ("状態の持ち方", "組織の一覧と本番の判定").
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import type { ApiUsage, LaunchOptions, Org, OrgsResponse, OrgSummary } from '../../shared/api.ts'
import { api } from '../apiClient.ts'
import { errorDetails, errorKind, errorMessage, isShownElsewhere, reloginCommand } from '../errors.ts'
import { t } from '../i18n/i18n.ts'
import { isProductionBySummary } from '../orgs/production.ts'
import { useApp } from './AppContext.tsx'
import { initialState, isNamed, reducer, type State } from './orgState.ts'
import { useTask } from './useTask.ts'

const SELECTED_KEY = 'sfbench.selectedOrg'

export type { OrgStatus, Seed } from './orgState.ts'

/** Which of the requests that write the org list is running. */
type ListRequest = 'load' | 'wait' | 'check'

export type OrgContextValue = State & {
  /** The list is being loaded (not waiting for or running the connection check). */
  loading: boolean
  selectedOrg: Org | undefined
  selectedSummary: OrgSummary | undefined
  isProduction: boolean
  /** Runs the connection check again (the "check again" button). */
  recheckConnections: () => Promise<void>
  selectOrg: (username: string) => void
  setPickerOpen: (open: boolean) => void
  reportApiUsage: (username: string, usage: ApiUsage | undefined) => void
  /** Handles org-specific API errors. Returns true when handled. */
  handleOrgError: (username: string, e: unknown) => boolean
  /** Like handleOrgError, but notifies any other error too (for loads with no place to show it). */
  reportOrgError: (username: string, e: unknown) => void
  /** Marks the org as needing login again without a notification (the caller shows the error). */
  markAuthError: (username: string, reloginCommand: string | undefined) => void
}

const OrgContext = createContext<OrgContextValue | undefined>(undefined)

/** Waits, or rejects when the signal aborts. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

function readSelected(): string | undefined {
  try {
    return sessionStorage.getItem(SELECTED_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function saveSelected(username: string): void {
  try {
    sessionStorage.setItem(SELECTED_KEY, username)
  } catch {
    // Only the reload convenience is lost.
  }
}

export function OrgProvider({ launch, children }: { launch: LaunchOptions | undefined; children: ReactNode }) {
  const { handleCommonError, notify, reportError } = useApp()
  const [state, dispatch] = useReducer(reducer, launch, initialState)
  // Loading the list, waiting for the background check and checking again
  // all write the list, so they share one task: the newest replaces the rest
  // (docs/web.md "流れごとの指定"). Its progress says which one runs.
  const list = useTask<ListRequest>()
  const { start: startList } = list
  const { start: startSummary } = useTask()

  const reportApiUsage = useCallback((username: string, usage: ApiUsage | undefined) => {
    if (usage) dispatch({ type: 'apiUsage', username, usage })
  }, [])

  const runList = useCallback(
    (request: ListRequest, call: (signal: AbortSignal) => Promise<OrgsResponse>) =>
      startList((signal, progress) => {
        progress(request)
        return call(signal)
      }, 'replace'),
    [startList],
  )

  const loadOrgs = useCallback(
    async (refresh: boolean) => {
      const outcome = await runList('load', (signal) => api.orgs(refresh, false, signal))
      if (outcome.kind === 'done') dispatch({ type: 'loaded', ...outcome.value })
      if (outcome.kind === 'error') {
        const handled = handleCommonError(outcome.error)
        dispatch({ type: 'loadFailed', message: handled ? '' : errorMessage(outcome.error) })
      }
    },
    [runList, handleCommonError],
  )

  const handleOrgError = useCallback(
    (username: string, e: unknown) => {
      if (handleCommonError(e)) return true
      const kind = errorKind(e)
      if (kind === 'orgAuth') {
        const command = reloginCommand(e)
        dispatch({ type: 'status', username, status: { state: 'authError', reloginCommand: command } })
        notify({ message: t.orgAuthError, command })
        return true
      }
      if (kind === 'orgNotFound') {
        void loadOrgs(true)
        dispatch({ type: 'picker', open: true })
        return true
      }
      return false
    },
    [handleCommonError, loadOrgs, notify],
  )

  const reportOrgError = useCallback(
    (username: string, e: unknown) => {
      if (handleOrgError(username, e)) return
      notify({ message: errorMessage(e), details: errorDetails(e) })
    },
    [handleOrgError, notify],
  )

  const markAuthError = useCallback((username: string, reloginCommand: string | undefined) => {
    dispatch({ type: 'status', username, status: { state: 'authError', reloginCommand } })
  }, [])

  const selectOrg = useCallback(
    (username: string) => {
      dispatch({ type: 'select', username })
      saveSelected(username)
      // Without a summary, production is judged from the org list and no
      // namespace is assumed; a failure here is not shown (docs/web.md).
      void startSummary((signal) => api.summary(username, signal), 'replace').then((outcome) => {
        if (outcome.kind === 'done') {
          dispatch({ type: 'summary', username, summary: outcome.value })
          dispatch({ type: 'status', username, status: { state: 'ok' } })
          reportApiUsage(username, outcome.value.apiUsage)
        }
        if (outcome.kind === 'error') {
          // Other failures (such as a user who cannot read Organization) are not shown.
          if (isShownElsewhere(errorKind(outcome.error))) handleOrgError(username, outcome.error)
        }
      })
    },
    [startSummary, handleOrgError, reportApiUsage],
  )

  // Startup: load the org list (docs/web.md "起動から作業画面まで"). Under
  // StrictMode the first load is cancelled and this runs again.
  useEffect(() => {
    void loadOrgs(false)
  }, [loadOrgs])

  // While the server's background connection check runs, wait for it and
  // update the list, so that unavailable orgs disappear (docs/screens.md).
  // A wait that ends with the check still pending makes this true again.
  const waitNeeded = state.orgs !== undefined && state.connectionCheck === 'pending' && !list.running
  useEffect(() => {
    if (!waitNeeded) return
    void runList('wait', async (signal) => {
      const response = await api.orgs(false, true, signal)
      // The check may not have started yet; ask again a little later.
      if (response.connectionCheck === 'pending') await delay(2000, signal)
      return response
    }).then((outcome) => {
      if (outcome.kind === 'done') dispatch({ type: 'loaded', ...outcome.value })
      if (outcome.kind === 'error') {
        // Not shown, apart from a lost session or a missing sf CLI.
        handleCommonError(outcome.error)
        dispatch({ type: 'waitFailed' })
      }
    })
  }, [waitNeeded, runList, handleCommonError])

  const recheckConnections = useCallback(async () => {
    const outcome = await runList('check', (signal) => api.checkConnections(signal))
    if (outcome.kind === 'done') dispatch({ type: 'loaded', ...outcome.value })
    if (outcome.kind === 'error') reportError(outcome.error)
  }, [runList, reportError])

  // Choose the org once, when the first org list arrives, whichever load
  // delivered it (the user may open the list while the first load runs).
  const chosen = useRef(false)
  useEffect(() => {
    if (chosen.current) return
    if (state.orgs === undefined) {
      // The first load failed: open the list, which shows the error.
      if (state.loadError) {
        chosen.current = true
        dispatch({ type: 'picker', open: true })
      }
      return
    }
    chosen.current = true
    // A new launch uses only what the launch says; a tab reload restores the saved org.
    const wanted = launch ? launch.org : readSelected()
    const found = wanted ? state.orgs.find((o) => isNamed(o, wanted)) : undefined
    if (found) {
      selectOrg(found.username)
      return
    }
    const notice = launch?.org ? t.unknownLaunchOrg(launch.org) : launch ? t.noDefaultOrg : undefined
    dispatch({ type: 'picker', open: true, notice })
  }, [state.orgs, state.loadError, launch, selectOrg])

  const setPickerOpen = useCallback(
    (open: boolean) => {
      dispatch({ type: 'picker', open })
      // Pick up orgs added or logged in again with the sf CLI.
      if (open) void loadOrgs(true)
    },
    [loadOrgs],
  )


  const listRequest = list.progress
  const value = useMemo<OrgContextValue>(() => {
    const selectedOrg = state.orgs?.find((o) => o.username === state.selected)
    const selectedSummary = state.selected ? state.summaries[state.selected] : undefined
    return {
      ...state,
      // Until the first list or failure arrives, the list counts as loading.
      loading: listRequest === 'load' || (state.orgs === undefined && state.loadError === undefined),
      connectionCheck: listRequest === 'check' ? 'pending' : state.connectionCheck,
      selectedOrg,
      selectedSummary,
      // An org no longer in the list counts as production (docs/screens.md).
      isProduction: selectedOrg ? isProductionBySummary(selectedOrg, selectedSummary) : state.selected !== undefined,
      recheckConnections,
      selectOrg,
      setPickerOpen,
      reportApiUsage,
      handleOrgError,
      reportOrgError,
      markAuthError,
    }
  }, [state, listRequest, recheckConnections, selectOrg, setPickerOpen, reportApiUsage, handleOrgError, reportOrgError, markAuthError])

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
}

// The hooks live next to their provider; this file is not hot-reloaded as a component.
// oxlint-disable-next-line react/only-export-components
export function useOrgs(): OrgContextValue {
  const value = useContext(OrgContext)
  if (!value) throw new Error('useOrgs must be used inside OrgProvider')
  return value
}

/** Reports a failed load (such as a describe) once per error. */
// oxlint-disable-next-line react/only-export-components
export function useReportOrgError(username: string, error: unknown): void {
  const { reportOrgError } = useOrgs()
  useEffect(() => {
    if (error !== undefined) reportOrgError(username, error)
    // Report each error once, not again when the callback changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, error])
}
