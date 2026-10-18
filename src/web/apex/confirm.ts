// Whether to ask before running Apex (docs/apex.md "確認するかどうか"). Decided here only.
import type { ApexHistoryEntry } from '../../shared/api.ts'
import { confirmReasons, type ConfirmReason } from '../execution.ts'

/** The same code: as written, with its line ends made LF. */
export function sameCode(a: string, b: string): boolean {
  return a.replace(/\r\n?/g, '\n') === b.replace(/\r\n?/g, '\n')
}

/**
 * The reasons to ask, or none. Apex may always change data. A pending record
 * is always this server's: the server reads a stopped server's as unknown.
 */
export function needsApexConfirm(
  code: string,
  context: { isProduction: boolean; history: readonly ApexHistoryEntry[]; historyLoaded: boolean },
): ConfirmReason[] {
  const open = context.history.filter((e) => e.outcome.state === 'pending' || e.outcome.state === 'unknown')
  const sameUnknown = open.some((e) => sameCode(e.code, code))
  return confirmReasons({
    changesData: true,
    isProduction: context.isProduction,
    historyLoaded: context.historyLoaded,
    sameUnknown,
    // Code a little changed after an unknown outcome is run again often: any run still waiting counts.
    otherPending: !sameUnknown && open.some((e) => e.outcome.state === 'pending'),
  })
}
