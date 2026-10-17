// The org list, the selected org and the launch query as a reducer, apart
// from the provider so that it can be tested as the tables in docs/web.md.
import type { ApiUsage, LaunchOptions, Org, OrgsResponse, OrgSummary } from '../../shared/api.ts'

/** Whether `name` (an alias or a username, as given on the command line) names this org. */
export function isNamed(org: Pick<Org, 'username' | 'alias'>, name: string): boolean {
  return org.alias === name || org.username === name
}

export type OrgStatus = { state: 'ok' } | { state: 'authError'; reloginCommand?: string }

/** What the first workspace shown gets from the launch (docs/web.md "起動時のクエリ"). */
export type Seed = { query: string; run: boolean }

export type State = {
  orgs: Org[] | undefined
  connectionCheck: OrgsResponse['connectionCheck']
  /** Why the latest load of the list failed, until a list arrives. */
  loadError: string | undefined
  selected: string | undefined
  summaries: Record<string, OrgSummary>
  status: Record<string, OrgStatus>
  apiUsage: Record<string, ApiUsage>
  pickerOpen: boolean
  /** A message at the top of the org list, such as "no default org". */
  notice: string | undefined
  /** The --org/--query/--run given at launch, until an org is selected. */
  launch: { org: string | undefined; query: string; run: boolean } | undefined
  /** For the workspace of the selected org, until another org is selected. */
  seed: Seed | undefined
}

export type Action =
  | { type: 'loaded'; orgs: Org[]; connectionCheck: OrgsResponse['connectionCheck'] }
  | { type: 'loadFailed'; message: string }
  | { type: 'waitFailed' }
  | { type: 'select'; username: string }
  | { type: 'summary'; username: string; summary: OrgSummary }
  | { type: 'status'; username: string; status: OrgStatus }
  | { type: 'apiUsage'; username: string; usage: ApiUsage }
  | { type: 'picker'; open: boolean; notice?: string }

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loaded':
      return { ...state, orgs: action.orgs, connectionCheck: action.connectionCheck, loadError: undefined }
    case 'loadFailed':
      return { ...state, loadError: action.message }
    case 'waitFailed':
      // Not shown as an error: the list offers to check again instead of waiting forever.
      return { ...state, connectionCheck: 'failed' }
    case 'select': {
      const closed = { ...state, pickerOpen: false, notice: undefined }
      // The same org again: the workspace stays, and so does what it was given.
      if (action.username === state.selected) return closed
      // The only place that decides whether the launch query runs: in the org
      // the launch named, and nowhere else.
      const { launch } = state
      const org = state.orgs?.find((o) => o.username === action.username) ?? { username: action.username }
      const seed = launch && { query: launch.query, run: launch.run && launch.org !== undefined && isNamed(org, launch.org) }
      return { ...closed, selected: action.username, launch: undefined, seed }
    }
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

export function initialState(launch: LaunchOptions | undefined): State {
  return {
    orgs: undefined,
    connectionCheck: 'pending',
    loadError: undefined,
    selected: undefined,
    summaries: {},
    status: {},
    apiUsage: {},
    pickerOpen: false,
    notice: undefined,
    launch: launch?.query ? { org: launch.org, query: launch.query, run: launch.run === true } : undefined,
    seed: undefined,
  }
}
