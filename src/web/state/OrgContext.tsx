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
import { ApiRequestError, api } from '../api/client.ts'
import { t } from '../i18n/i18n.ts'
import { isProductionBySummary } from '../orgs/production.ts'
import { useApp } from './AppContext.tsx'

const SELECTED_KEY = 'sfbench.selectedOrg'

export type OrgStatus = { state: 'ok' } | { state: 'authError'; reloginCommand?: string }

type State = {
  orgs: Org[] | undefined
  loading: boolean
  loadError: string | undefined
  selected: string | undefined
  summaries: Record<string, OrgSummary>
  status: Record<string, OrgStatus>
  apiUsage: Record<string, ApiUsage>
  pickerOpen: boolean
  /** A message at the top of the org list, such as "no default org". */
  notice: string | undefined
}

type Action =
  | { type: 'loading' }
  | { type: 'loaded'; orgs: Org[] }
  | { type: 'loadFailed'; message: string }
  | { type: 'select'; username: string }
  | { type: 'summary'; username: string; summary: OrgSummary }
  | { type: 'status'; username: string; status: OrgStatus }
  | { type: 'apiUsage'; username: string; usage: ApiUsage }
  | { type: 'picker'; open: boolean; notice?: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loading':
      return { ...state, loading: true, loadError: undefined }
    case 'loaded':
      return { ...state, loading: false, orgs: action.orgs }
    case 'loadFailed':
      return { ...state, loading: false, loadError: action.message }
    case 'select':
      return { ...state, selected: action.username, pickerOpen: false, notice: undefined }
    case 'summary':
      return { ...state, summaries: { ...state.summaries, [action.username]: action.summary } }
    case 'status':
      return { ...state, status: { ...state.status, [action.username]: action.status } }
    case 'apiUsage':
      return { ...state, apiUsage: { ...state.apiUsage, [action.username]: action.usage } }
    case 'picker':
      return { ...state, pickerOpen: action.open, notice: action.open ? (action.notice ?? state.notice) : undefined }
  }
}

const initialState: State = {
  orgs: undefined,
  loading: true,
  loadError: undefined,
  selected: undefined,
  summaries: {},
  status: {},
  apiUsage: {},
  pickerOpen: false,
  notice: undefined,
}

export type OrgContextValue = State & {
  selectedOrg: Org | undefined
  selectedSummary: OrgSummary | undefined
  isProduction: boolean
  /** Loads the org list. Resolves to the list, or undefined if it failed or a newer load replaced it. */
  loadOrgs: (refresh: boolean) => Promise<Org[] | undefined>
  selectOrg: (username: string) => void
  setPickerOpen: (open: boolean) => void
  reportApiUsage: (username: string, usage: ApiUsage | undefined) => void
  /** Handles org-specific API errors. Returns true when handled. */
  handleOrgError: (username: string, e: unknown) => boolean
  /** The --query/--run given at launch, returned once (for the SOQL editor). */
  takeLaunchQuery: () => { query: string; run: boolean } | undefined
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
  const [state, dispatch] = useReducer(reducer, initialState)
  const started = useRef(false)
  const loadGeneration = useRef(0)
  const launchQuery = useRef<{ query: string; run: boolean } | undefined>(
    launch?.query ? { query: launch.query, run: launch.run === true } : undefined,
  )

  const reportApiUsage = useCallback((username: string, usage: ApiUsage | undefined) => {
    if (usage) dispatch({ type: 'apiUsage', username, usage })
  }, [])

  const loadOrgs = useCallback(
    async (refresh: boolean) => {
      // A newer load wins: an older `sf org list` result arriving later is dropped.
      const generation = ++loadGeneration.current
      dispatch({ type: 'loading' })
      try {
        const { orgs } = await api.orgs(refresh)
        if (generation !== loadGeneration.current) return undefined
        dispatch({ type: 'loaded', orgs })
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
    const found = wanted ? state.orgs.find((o) => o.alias === wanted || o.username === wanted) : undefined
    if (found) {
      selectOrg(found.username)
      return
    }
    // No org to run in: the query is put in the editor but not run (docs/web.md).
    launchQuery.current = launchQuery.current && { ...launchQuery.current, run: false }
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

  const takeLaunchQuery = useCallback(() => {
    const value = launchQuery.current
    launchQuery.current = undefined
    return value
  }, [])

  const value = useMemo<OrgContextValue>(() => {
    const selectedOrg = state.orgs?.find((o) => o.username === state.selected)
    const selectedSummary = state.selected ? state.summaries[state.selected] : undefined
    return {
      ...state,
      selectedOrg,
      selectedSummary,
      isProduction: selectedOrg ? isProductionBySummary(selectedOrg, selectedSummary) : false,
      loadOrgs,
      selectOrg,
      setPickerOpen,
      reportApiUsage,
      handleOrgError,
      takeLaunchQuery,
    }
  }, [state, loadOrgs, selectOrg, setPickerOpen, reportApiUsage, handleOrgError, takeLaunchQuery])

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
}

// The hook lives next to its provider; this file is not hot-reloaded as a component.
// oxlint-disable-next-line react/only-export-components
export function useOrgs(): OrgContextValue {
  const value = useContext(OrgContext)
  if (!value) throw new Error('useOrgs must be used inside OrgProvider')
  return value
}
