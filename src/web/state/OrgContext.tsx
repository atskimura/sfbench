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
import type { ApiUsage, LaunchOptions, Org, OrgSummary } from '../../shared/api.ts'
import { ApiRequestError, api } from '../apiClient.ts'
import { t } from '../i18n/i18n.ts'
import { isProductionBySummary } from '../orgs/production.ts'
import { useApp } from './AppContext.tsx'
import { initialState, isNamed, reducer, type State } from './orgState.ts'

const SELECTED_KEY = 'sfbench.selectedOrg'

export type { OrgStatus, Seed } from './orgState.ts'

export type OrgContextValue = State & {
  selectedOrg: Org | undefined
  selectedSummary: OrgSummary | undefined
  isProduction: boolean
  /** Loads the org list. Resolves to the list, or undefined if it failed or a newer load replaced it. */
  loadOrgs: (refresh: boolean) => Promise<Org[] | undefined>
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
  const { handleCommonError, notify } = useApp()
  const [state, dispatch] = useReducer(reducer, launch, initialState)
  const started = useRef(false)
  const loadGeneration = useRef(0)

  const reportApiUsage = useCallback((username: string, usage: ApiUsage | undefined) => {
    if (usage) dispatch({ type: 'apiUsage', username, usage })
  }, [])

  const loadOrgs = useCallback(
    async (refresh: boolean) => {
      // A newer load wins: an older `sf org list` result arriving later is dropped.
      const generation = ++loadGeneration.current
      dispatch({ type: 'loading' })
      try {
        const { orgs, connectionCheck } = await api.orgs(refresh)
        if (generation !== loadGeneration.current) return undefined
        dispatch({ type: 'loaded', orgs, connectionCheck })
        return orgs
      } catch (e) {
        if (generation !== loadGeneration.current) return undefined
        const handled = handleCommonError(e)
        dispatch({ type: 'loadFailed', message: handled ? '' : (e as Error).message })
        return undefined
      }
    },
    [handleCommonError],
  )

  const handleOrgError = useCallback(
    (username: string, e: unknown) => {
      if (handleCommonError(e)) return true
      if (!(e instanceof ApiRequestError)) return false
      if (e.code === 'ORG_AUTH_ERROR') {
        dispatch({ type: 'status', username, status: { state: 'authError', reloginCommand: e.body?.reloginCommand } })
        notify({ message: t.orgAuthError, command: e.body?.reloginCommand })
        return true
      }
      if (e.code === 'NOT_FOUND') {
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
      if (e instanceof ApiRequestError && e.code === 'ABORTED') return
      const details = e instanceof ApiRequestError && e.code === 'SALESFORCE_ERROR' ? e.body?.details : undefined
      notify({ message: e instanceof Error ? e.message : String(e), details })
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
      api.summary(username).then(
        (summary) => {
          dispatch({ type: 'summary', username, summary })
          dispatch({ type: 'status', username, status: { state: 'ok' } })
          reportApiUsage(username, summary.apiUsage)
        },
        (e: unknown) => {
          // Other failures (such as a user who cannot read Organization) are not shown.
          const shown = ['ORG_AUTH_ERROR', 'NOT_FOUND', 'SF_CLI_NOT_FOUND']
          if (e instanceof ApiRequestError && (shown.includes(e.code) || e.isSessionLost)) handleOrgError(username, e)
        },
      )
    },
    [handleOrgError, reportApiUsage],
  )

  // Startup: load the org list once (docs/web.md "起動から作業画面まで").
  useEffect(() => {
    if (started.current) return
    started.current = true
    void loadOrgs(false)
  }, [loadOrgs])

  // While the server's background connection check runs, wait for it and
  // update the list, so that unavailable orgs disappear (docs/screens.md).
  const waiting = useRef(false)
  useEffect(() => {
    if (state.orgs === undefined || state.connectionCheck !== 'pending' || waiting.current) return
    waiting.current = true
    const generation = loadGeneration.current
    api.orgs(false, true).then(
      async ({ orgs, connectionCheck }) => {
        // The check may not have started yet; ask again a little later.
        if (connectionCheck === 'pending') await new Promise((resolve) => setTimeout(resolve, 2000))
        waiting.current = false
        if (generation === loadGeneration.current) dispatch({ type: 'loaded', orgs, connectionCheck })
      },
      () => {
        waiting.current = false
      },
    )
  }, [state.orgs, state.connectionCheck])

  const recheckConnections = useCallback(async () => {
    const generation = ++loadGeneration.current
    dispatch({ type: 'checking' })
    try {
      const { orgs, connectionCheck } = await api.checkConnections()
      if (generation === loadGeneration.current) dispatch({ type: 'loaded', orgs, connectionCheck })
    } catch (e) {
      if (!handleCommonError(e)) notify({ message: (e as Error).message })
    }
  }, [handleCommonError, notify])

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


  const value = useMemo<OrgContextValue>(() => {
    const selectedOrg = state.orgs?.find((o) => o.username === state.selected)
    const selectedSummary = state.selected ? state.summaries[state.selected] : undefined
    return {
      ...state,
      selectedOrg,
      selectedSummary,
      isProduction: selectedOrg ? isProductionBySummary(selectedOrg, selectedSummary) : false,
      loadOrgs,
      recheckConnections,
      selectOrg,
      setPickerOpen,
      reportApiUsage,
      handleOrgError,
      reportOrgError,
      markAuthError,
    }
  }, [state, loadOrgs, recheckConnections, selectOrg, setPickerOpen, reportApiUsage, handleOrgError, reportOrgError, markAuthError])

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
