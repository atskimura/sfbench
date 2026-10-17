// Later pages of a result (docs/web.md "流れごとの指定"): the reducer's table.
import { describe, expect, it } from 'vitest'
import { pagesReducer, type Pages } from './pages.ts'

const start: Pages = { next: '/next/1', loaded: 2, columns: [], failure: false }
const page = (from: string, next: string | undefined, loaded = 4) =>
  ({ type: 'page', from, records: [{ Id: '003', Name: 'Row 3' }], loaded, next }) as const

describe('later pages', () => {
  it('takes the page that continues the current one, and moves on', () => {
    const state = pagesReducer(start, page('/next/1', '/next/2'))
    expect(state).toMatchObject({ next: '/next/2', loaded: 4, failure: false })
    expect(state.columns.map((c) => c.key)).toEqual(['Id', 'Name'])
  })

  it('drops the same page arriving again', () => {
    const once = pagesReducer(start, page('/next/1', '/next/2'))
    expect(pagesReducer(once, page('/next/1', '/next/2', 6))).toBe(once)
  })

  it('drops a failure of a page already taken', () => {
    const once = pagesReducer(start, page('/next/1', '/next/2'))
    expect(pagesReducer(once, { type: 'failed', from: '/next/1', failure: 'retry' })).toBe(once)
  })

  it('keeps a failure until a page is taken', () => {
    const failed = pagesReducer(start, { type: 'failed', from: '/next/1', failure: 'retry' })
    expect(failed).toMatchObject({ next: '/next/1', loaded: 2, failure: 'retry' })
    expect(pagesReducer(failed, page('/next/1', undefined)).failure).toBe(false)
    expect(pagesReducer(start, { type: 'failed', from: '/next/1', failure: 'rerun' }).failure).toBe('rerun')
  })
})
