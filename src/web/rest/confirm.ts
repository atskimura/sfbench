// Whether to ask before sending (docs/rest.md "確認するかどうか"). Decided here only.
import type { RestHistoryEntry } from '../../shared/api.ts'
import { restMayChangeData } from './changes.ts'
import { sameRequest, type RestSnapshot } from './request.ts'

export type ConfirmReason =
  /** The same request was sent before and its outcome is not known. */
  | 'unknownOutcome'
  /** A request that may change data, in a production org. */
  | 'production'

/**
 * The reasons to ask, or none. The history is the server's, so the unknown
 * outcome is remembered across reloads, org switches and other tabs.
 */
export function needsConfirm(request: RestSnapshot, context: { isProduction: boolean; history: readonly RestHistoryEntry[] }): ConfirmReason[] {
  const reasons: ConfirmReason[] = []
  const unknown = context.history.some((e) => (e.outcome.state === 'pending' || e.outcome.state === 'unknown') && sameRequest(e, request))
  if (unknown) reasons.push('unknownOutcome')
  if (context.isProduction && restMayChangeData(request.method, request.path)) reasons.push('production')
  return reasons
}
