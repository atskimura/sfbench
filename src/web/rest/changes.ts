// Whether a REST request may change data, as the screen sees it (docs/rest.md
// "データを変えうる要求か"). Decided here only. The server never sends any
// REST request twice, whatever this says.
import type { RestMethod } from '../../shared/api.ts'

/**
 * Any method but GET; and a GET to the user's Apex REST or to the Tooling
 * API's executeAnonymous, which can change data too. Paths are told apart by
 * their text, so a GET elsewhere that changes data is missed.
 */
export function restMayChangeData(method: RestMethod, path: string): boolean {
  if (method !== 'GET') return true
  const p = path.toLowerCase()
  return p.includes('/services/apexrest/') || p.includes('/executeanonymous')
}
