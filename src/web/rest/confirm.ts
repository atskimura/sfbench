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
    /** The request the screen last showed as of unknown outcome: before the history is loaded again, or if it cannot be. */
    lastUnknown: RestSnapshot | undefined
  },
): ConfirmReason[] {
  const reasons: ConfirmReason[] = []
  const unknown =
    (context.lastUnknown !== undefined && sameRequest(context.lastUnknown, request)) ||
    context.history.some((e) => (e.outcome.state === 'pending' || e.outcome.state === 'unknown') && sameRecorded(e, request))
  if (unknown) reasons.push('unknownOutcome')
  if (context.isProduction && restMayChangeData(request.method, request.path)) reasons.push('production')
  return reasons
}
