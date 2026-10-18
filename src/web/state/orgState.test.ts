// The launch query's states and transitions (docs/web.md "起動時のクエリ").
import { describe, expect, it } from 'vitest'
import type { LaunchOptions, Org } from '../../shared/api.ts'
import { initialState, reducer } from './orgState.ts'

const org = (alias: string | undefined, username: string): Org => ({
  username,
  alias,
  instanceUrl: 'https://example.my.salesforce.com',
  kind: 'sandbox',
  isExpired: false,
  availability: 'ok',
})
const orgs = [org('one', 'one@example.com'), org('two', 'two@example.com'), org(undefined, 'bare@example.com')]
const listed = (launch: LaunchOptions | undefined) =>
  reducer(initialState(launch), { type: 'loaded', orgs, connectionCheck: 'done' })
const launched = (run: boolean, launchOrg: string | undefined = 'one') =>
  listed({ org: launchOrg, query: 'SELECT Id FROM Account', run })
const select = (username: string) => ({ type: 'select' as const, username })

describe('launch query', () => {
  it('runs in the org the launch named, by alias or username', () => {
    expect(reducer(launched(true), select('one@example.com')).seed).toEqual({ query: 'SELECT Id FROM Account', run: true })
    expect(reducer(launched(true, 'one@example.com'), select('one@example.com')).seed?.run).toBe(true)
    expect(reducer(launched(false), select('one@example.com')).seed?.run).toBe(false)
  })

  it('puts the query in without running in another org', () => {
    const state = reducer(launched(true), select('two@example.com'))
    expect(state.seed).toEqual({ query: 'SELECT Id FROM Account', run: false })
    expect(state.launch).toBeUndefined()
  })

  it('runs in the named org by username even before it is in the list', () => {
    const state = reducer(initialState({ org: 'new@example.com', query: 'SELECT Id FROM Account', run: true }), select('new@example.com'))
    expect(state.seed?.run).toBe(true)
  })

  it('does not run without a launch org, even in an org without an alias', () => {
    expect(reducer(launched(true, undefined), select('bare@example.com')).seed?.run).toBe(false)
  })

  it('gives nothing to the next org, or after a reload', () => {
    const first = reducer(launched(true), select('one@example.com'))
    expect(reducer(first, select('two@example.com')).seed).toBeUndefined()
    expect(reducer(reducer(first, select('two@example.com')), select('one@example.com')).seed).toBeUndefined()
    expect(reducer(listed(undefined), select('one@example.com')).seed).toBeUndefined()
    expect(reducer(listed({ org: 'one', run: true }), select('one@example.com')).seed).toBeUndefined()
  })

  it('keeps the seed when the same org is chosen again', () => {
    const first = reducer(launched(true), select('one@example.com'))
    expect(reducer(first, select('one@example.com')).seed).toBe(first.seed)
  })
})

// docs/web.md "組織の一覧の状態と遷移"
describe('org list', () => {
  it('clears a failed load when a list arrives', () => {
    const failed = reducer(initialState(undefined), { type: 'loadFailed', message: 'sf org list failed' })
    expect(failed.loadError).toBe('sf org list failed')
    expect(reducer(failed, { type: 'loaded', orgs, connectionCheck: 'done' }).loadError).toBeUndefined()
  })

  it('stops waiting for the check when waiting fails', () => {
    const pending = reducer(initialState(undefined), { type: 'loaded', orgs, connectionCheck: 'pending' })
    const failed = reducer(pending, { type: 'waitFailed' })
    expect(failed.connectionCheck).toBe('failed')
    expect(failed.orgs).toBe(orgs)
  })
})

// docs/rest.md "`--rest` の起動時の指定"
describe('launch REST request', () => {
  const rest = { method: 'DELETE' as const, path: '/services/data/v66.0/sobjects/Account/001' }
  const launchedRest = (launchOrg: string | undefined) => reducer(initialState({ org: launchOrg, rest }), { type: 'loaded', orgs, connectionCheck: 'done' })

  it('goes into the org the launch named', () => {
    expect(reducer(launchedRest('one'), select('one@example.com')).seed).toEqual({ query: undefined, run: false, rest })
  })

  it('is left out of another org, which is told why', () => {
    const seed = reducer(launchedRest('one'), select('two@example.com')).seed
    expect(seed?.rest).toBeUndefined()
    expect(seed?.restLeftOutFor).toBe('one')
  })
})

// docs/apex.md "`--apex` の起動時の指定"
describe('launch Apex code', () => {
  const apex = { code: "delete [SELECT Id FROM Account WHERE Name = 'x'];" }
  const launchedApex = (launchOrg: string | undefined) => reducer(initialState({ org: launchOrg, apex }), { type: 'loaded', orgs, connectionCheck: 'done' })

  it('goes into the org the launch named', () => {
    expect(reducer(launchedApex('one'), select('one@example.com')).seed).toEqual({ query: undefined, run: false, apex })
  })

  it('is left out of another org, which is told why', () => {
    const seed = reducer(launchedApex('one'), select('two@example.com')).seed
    expect(seed?.apex).toBeUndefined()
    expect(seed?.apexLeftOutFor).toBe('one')
  })
})
