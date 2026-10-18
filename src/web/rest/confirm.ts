// Whether to ask before sending (docs/rest.md "確認するかどうか"). Decided here only.
import type { RestHistoryEntry } from '../../shared/api.ts'
import { restMayChangeData } from './changes.ts'
import { sameRequest, type RestSnapshot } from './request.ts'

/**
 * A record is the same request as written; one whose body was too long to
 * keep counts as the same when its method and path are, so that asking again
 * errs on the side of asking.
 */
function sameRecorded(entry: RestHistoryEntry, request: RestSnapshot): boolean {
  if (entry.bodyOmitted) return entry.method === request.method && entry.path === request.path
  return sameRequest(entry, request)
}

export type ConfirmReason =
  /** The same request was sent before and its outcome is not known. */
  | 'unknownOutcome'
  /** The history has not been loaded, so an earlier unknown outcome cannot be told. */
  | 'historyUnknown'
  /** A request that may change data, in a production org. */
  | 'production'

/**
 * The reasons to ask, or none. The history is the server's, so the unknown
 * outcome is remembered across reloads, org switches and other tabs.
 */
export function needsConfirm(
  request: RestSnapshot,
  context: {
    isProduction: boolean
    history: readonly RestHistoryEntry[]
    /** The history has been loaded from the server at least once. */
    historyLoaded: boolean
  },
): ConfirmReason[] {
  const reasons: ConfirmReason[] = []
  // Sending a request that changes no data again does no harm, whatever happened to it before.
  const changesData = restMayChangeData(request.method, request.path)
  if (changesData && !context.historyLoaded) reasons.push('historyUnknown')
  const unknown = context.history.some((e) => (e.outcome.state === 'pending' || e.outcome.state === 'unknown') && sameRecorded(e, request))
  if (changesData && unknown) reasons.push('unknownOutcome')
  if (context.isProduction && changesData) reasons.push('production')
  return reasons
}
