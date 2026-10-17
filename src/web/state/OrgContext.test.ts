// The launch query's states and transitions (docs/web.md "起動時のクエリ").
import { describe, expect, it } from 'vitest'
import { initialState, reducer } from './OrgContext.tsx'

const launched = (run: boolean) => initialState({ org: 'one', query: 'SELECT Id FROM Account', run })
const select = (username: string, source: 'launch' | 'user') => ({ type: 'select' as const, username, source })

describe('launch query', () => {
  it('runs only when the launch org was found and chosen', () => {
    expect(reducer(launched(true), select('one', 'launch')).seed).toEqual({ id: 1, query: 'SELECT Id FROM Account', run: true })
    expect(reducer(launched(false), select('one', 'launch')).seed?.run).toBe(false)
  })

  it('puts the query in without running when the user chose', () => {
    const state = reducer(launched(true), select('two', 'user'))
    expect(state.seed).toEqual({ id: 1, query: 'SELECT Id FROM Account', run: false })
    expect(state.launch).toBeUndefined()
  })

  it('gives nothing to the next org, or after a reload', () => {
    const first = reducer(launched(true), select('one', 'launch'))
    expect(reducer(first, select('two', 'user')).seed).toBeUndefined()
    expect(reducer(initialState(undefined), select('one', 'user')).seed).toBeUndefined()
    expect(reducer(initialState({ org: 'one', run: true }), select('one', 'launch')).seed).toBeUndefined()
  })

  it('keeps the seed when the same org is chosen again', () => {
    const first = reducer(launched(true), select('one', 'launch'))
    expect(reducer(first, select('one', 'user')).seed).toBe(first.seed)
  })

  it('drops the seed once taken, and only that seed', () => {
    const first = reducer(launched(true), select('one', 'launch'))
    expect(reducer(first, { type: 'seedUsed', id: 2 }).seed).toBe(first.seed)
    expect(reducer(first, { type: 'seedUsed', id: 1 }).seed).toBeUndefined()
  })
})
