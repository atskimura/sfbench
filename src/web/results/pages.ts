// The later pages of a shown result (docs/web.md "流れごとの指定"): the rows
// loaded so far, which page comes next, and whether loading failed. Whether
// a page that arrived is taken is decided here only.
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
}

export type PagesAction =
  /** A page fetched from `from` arrived. */
  | { type: 'page'; from: string; records: readonly SObjectRecord[]; next: string | undefined }
  | { type: 'failed'; from: string; failure: NonNullable<Pages['failure']> }

/**
 * Takes only what continues the current rows: once a page is taken, `next`
 * moves on, so the same page arriving again (fetched twice) is dropped, and
 * so is its failure.
 */
export function pagesReducer(state: Pages, action: PagesAction): Pages {
  if (action.from !== state.next) return state
  switch (action.type) {
    case 'page':
      return {
        records: state.records.concat(action.records),
        next: action.next,
        columns: addColumns(state.columns, action.records),
        failure: undefined,
      }
    case 'failed':
      return { ...state, failure: action.failure }
  }
}
