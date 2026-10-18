// The REST request fields survive a tab reload in the same org, and only that,
// as the SOQL editor's text does (editorStorage.ts).
import { REST_METHODS } from '../../shared/api.ts'
import type { RestDraft } from './request.ts'

const DRAFT_KEY = 'sfbench.restDraft'

/** Makes the storage the draft of `org` and returns its first draft: `initial` (from --rest) if given, else what was saved for this org. */
export function claimRestDraft(org: string, initial: RestDraft | undefined, empty: RestDraft): RestDraft {
  if (initial) {
    saveRestDraft(org, initial)
    return initial
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null') as { org?: unknown; draft?: Partial<RestDraft> } | null
    const d = saved?.draft
    if (saved?.org === org && d && (REST_METHODS as readonly unknown[]).includes(d.method) && typeof d.path === 'string' && typeof d.body === 'string' && Array.isArray(d.headers)) {
      return d as RestDraft
    }
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // Unreadable or unavailable: start empty.
  }
  return empty
}

export function saveRestDraft(org: string, draft: RestDraft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ org, draft }))
  } catch {
    // Only the reload convenience is lost.
  }
}
