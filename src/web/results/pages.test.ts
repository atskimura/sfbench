// Later pages of a result: one test per row of the table in docs/web.md "続きのページの状態と遷移".
import { describe, expect, it } from 'vitest'
import { pagesReducer, type Pages } from './pages.ts'

const first = [{ Id: '001', Name: 'Row 1' }]
const start: Pages = { records: first, next: '/next/1', columns: [], failure: undefined, removed: 0, revision: 0 }
const page = (from: string, next: string | undefined) =>
  ({ type: 'page', from, records: [{ Id: '002', Name: 'Row 2' }], next }) as const

describe('later pages', () => {
  it('takes the page that continues the rows, and moves on', () => {
    const state = pagesReducer(start, page('/next/1', '/next/2'))
    expect(state.records.map((r) => r.Id)).toEqual(['001', '002'])
    expect(state.next).toBe('/next/2')
    expect(state.columns.map((c) => c.key)).toEqual(['Id', 'Name'])
    // The rows themselves are shared, not copied; the first page stays as it was.
    expect(state.records[0]).toBe(first[0])
    expect(first).toHaveLength(1)
  })

  it('drops the same page arriving again, and its failure', () => {
    const once = pagesReducer(start, page('/next/1', '/next/2'))
    expect(pagesReducer(once, page('/next/1', '/next/2'))).toBe(once)
    expect(pagesReducer(once, { type: 'failed', from: '/next/1', failure: { kind: 'rerun' } })).toBe(once)
  })

  it('keeps a failure until a page is taken', () => {
    const error = new Error('down')
    const failed = pagesReducer(start, { type: 'failed', from: '/next/1', failure: { kind: 'retry', error } })
    expect(failed).toMatchObject({ next: '/next/1', failure: { kind: 'retry', error } })
    expect(failed.records).toBe(first)
    expect(pagesReducer(failed, page('/next/1', undefined)).failure).toBeUndefined()
  })

  it('gives the same answer when called twice (StrictMode calls reducers twice)', () => {
    const action = page('/next/1', undefined)
    expect(pagesReducer(start, action)).toEqual(pagesReducer(start, action))
    expect(start.records).toBe(first)
  })
})

// docs/edit.md "保存と削除": what a save or delete leaves in the loaded rows.
describe('edits written into the rows', () => {
  const rows: Pages = { ...start, records: [{ Id: 'a', Name: 'A' }, { Id: 'b', Name: 'B' }, { Id: 'c', Name: 'C' }] }

  it('writes saved values into new row objects, and leaves the other rows as they were', () => {
    const state = pagesReducer(rows, { type: 'patched', values: new Map([['b', { Name: 'B2', Rating: null }]]) })
    expect(state.records).toEqual([{ Id: 'a', Name: 'A' }, { Id: 'b', Name: 'B2', Rating: null }, { Id: 'c', Name: 'C' }])
    expect(state.records[0]).toBe(rows.records[0])
    expect(rows.records[1]).toEqual({ Id: 'b', Name: 'B' })
    expect(state.revision).toBe(1)
  })

  it('drops deleted rows and counts them', () => {
    const state = pagesReducer(rows, { type: 'removed', ids: new Set(['a', 'c', 'x']) })
    expect(state.records).toEqual([{ Id: 'b', Name: 'B' }])
    expect(state.removed).toBe(2)
    // The next page still continues from where it was.
    expect(state.next).toBe('/next/1')
  })
})
