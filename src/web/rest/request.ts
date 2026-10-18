// The request the REST API screen sends: the draft as it was when Send was
// pressed (docs/rest.md "作り").
import { methodTakesBody, type RestHistoryEntry, type RestMethod } from '../../shared/api.ts'

export type HeaderRow = { name: string; value: string }

/** What the request fields hold. The body is the editor's text. */
export type RestDraft = { method: RestMethod; path: string; headers: HeaderRow[]; body: string }

/** A request as sent: fixed when Send is pressed, so that later edits do not change it. */
export type RestSnapshot = { method: RestMethod; path: string; headers: Record<string, string>; body?: string }

export const emptyDraft: RestDraft = { method: 'GET', path: '', headers: [], body: '' }

/**
 * The request to send from a draft. A method without a body sends none, even
 * if the body field still holds text (the body of a POST changed to GET).
 * Header rows without a name are left out.
 */
export function snapshotOf(draft: RestDraft): RestSnapshot {
  const headers: Record<string, string> = {}
  for (const { name, value } of draft.headers) if (name.trim()) headers[name.trim()] = value
  const body = methodTakesBody(draft.method) && draft.body.trim() !== '' ? draft.body : undefined
  return { method: draft.method, path: draft.path.trim(), headers, ...(body !== undefined ? { body } : {}) }
}

/** The same request, for asking again before it is sent again: method, path and body as written (not headers). */
export function sameRequest(a: Pick<RestSnapshot, 'method' | 'path' | 'body'>, b: Pick<RestSnapshot, 'method' | 'path' | 'body'>): boolean {
  return a.method === b.method && a.path === b.path && (a.body ?? '') === (b.body ?? '')
}

/** A history entry put back into the fields. */
export function draftOf(entry: Pick<RestHistoryEntry, 'method' | 'path' | 'headers' | 'body'>): RestDraft {
  return {
    method: entry.method,
    path: entry.path,
    headers: Object.entries(entry.headers ?? {}).map(([name, value]) => ({ name, value })),
    body: entry.body ?? '',
  }
}
