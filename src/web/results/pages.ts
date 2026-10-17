// The later pages of a shown result (docs/web.md "流れごとの指定"): which
// page comes next, how many rows are loaded, and whether loading failed.
// Whether a page that arrived is taken is decided here only.
import { addColumns, type Column, type SObjectRecord } from './columns.ts'

export type Pages = {
  /** The URL of the next page, or undefined when none remains. */
  next: string | undefined
  /** How many of the result's records the table shows. */
  loaded: number
  columns: readonly Column[]
  /**
   * The last load failed: `retry` loads again only when asked (no automatic
   * retries); `rerun` cannot load again (the query locator expired).
   */
  failure: false | 'retry' | 'rerun'
}

export type PagesAction =
  /** A page of `from` arrived; the result's records now hold `loaded` rows. */
  | { type: 'page'; from: string; records: readonly SObjectRecord[]; loaded: number; next: string | undefined }
  | { type: 'failed'; from: string; failure: 'retry' | 'rerun' }

/**
 * Takes only what continues the current page: once a page is taken, `next`
 * moves on, so the same page arriving again (fetched twice) is dropped.
 */
export function pagesReducer(state: Pages, action: PagesAction): Pages {
  if (action.from !== state.next) return state
  switch (action.type) {
    case 'page':
      return { next: action.next, loaded: action.loaded, columns: addColumns(state.columns, action.records), failure: false }
    case 'failed':
      return { ...state, failure: action.failure }
  }
}
