// The later pages of a shown result (docs/web.md "流れごとの指定"): the rows
// loaded so far, which page comes next, and whether loading failed. Whether
// a page that arrived is taken is decided here only. Saved values and deleted
// rows from the result table's edits are written in here too (docs/edit.md).
import type { FieldValue } from '../../shared/api.ts'
import { addColumns, type Column, type SObjectRecord } from './columns.ts'

export type Pages = {
  /**
   * The rows loaded so far. A page makes a new array of the same row objects
   * (the rows are not copied), so that this stays a plain value.
   */
  records: readonly SObjectRecord[]
  /** The URL of the next page, or undefined when none remains. */
  next: string | undefined
  columns: readonly Column[]
  /**
   * The last load failed: `retry` loads again only when asked (no automatic
   * retries); `rerun` cannot load again (the query locator expired).
   */
  failure: undefined | { kind: 'retry'; error: unknown } | { kind: 'rerun' }
  /** Rows deleted from the result table, taken off the count of the result. */
  removed: number
  /** Counts the changes that rewrite loaded rows (not the pages that add rows). */
  revision: number
}

export type PagesAction =
  /** A page fetched from `from` arrived. */
  | { type: 'page'; from: string; records: readonly SObjectRecord[]; next: string | undefined }
  | { type: 'failed'; from: string; failure: NonNullable<Pages['failure']> }
  /** Saved values, by record Id and column key (a field of the row itself). */
  | { type: 'patched'; values: ReadonlyMap<string, Readonly<Record<string, FieldValue>>> }
  /** Deleted rows, by record Id. */
  | { type: 'removed'; ids: ReadonlySet<string> }

/**
 * Takes only what continues the current rows: once a page is taken, `next`
 * moves on, so the same page arriving again (fetched twice) is dropped, and
 * so is its failure.
 */
export function pagesReducer(state: Pages, action: PagesAction): Pages {
  switch (action.type) {
    case 'page':
      if (action.from !== state.next) return state
      return {
        ...state,
        records: state.records.concat(action.records),
        next: action.next,
        columns: addColumns(state.columns, action.records),
        failure: undefined,
      }
    case 'failed':
      if (action.from !== state.next) return state
      return { ...state, failure: action.failure }
    case 'patched':
      return {
        ...state,
        // A saved row becomes a new object; the others stay the same objects.
        records: state.records.map((r) => {
          const values = typeof r.Id === 'string' ? action.values.get(r.Id) : undefined
          return values ? { ...r, ...values } : r
        }),
        revision: state.revision + 1,
      }
    case 'removed': {
      const records = state.records.filter((r) => !(typeof r.Id === 'string' && action.ids.has(r.Id)))
      return { ...state, records, removed: state.removed + state.records.length - records.length, revision: state.revision + 1 }
    }
  }
}
