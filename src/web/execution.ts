// What the REST API and Apex screens share about running something that may
// change data (docs/rest.md "確認するかどうか", docs/apex.md "実行の流れ"):
// when to ask first, and what a failed run shows. Each screen decides only
// which earlier run is the same as this one.
import { isOutcomeUnknown, runFailure } from './errors.ts'

export type ConfirmReason =
  /** The same request or code was run before and its outcome is not known. */
  | 'unknownOutcome'
  /** The history has not been loaded, so an earlier unknown outcome cannot be told. */
  | 'historyUnknown'
  /** Another run is still waiting for its answer in this server, whatever it ran (Apex only). */
  | 'otherPending'
  /** A run that may change data, in a production org. */
  | 'production'

/** The reasons to ask, or none. A run that changes no data does no harm, whatever happened before. */
export function confirmReasons(facts: {
  changesData: boolean
  isProduction: boolean
  /** The history has been loaded from the server at least once. */
  historyLoaded: boolean
  /** The history has the same run, pending or of unknown outcome. */
  sameUnknown: boolean
  otherPending?: boolean
}): ConfirmReason[] {
  if (!facts.changesData) return []
  const reasons: ConfirmReason[] = []
  if (!facts.historyLoaded) reasons.push('historyUnknown')
  if (facts.sameUnknown) reasons.push('unknownOutcome')
  if (facts.otherPending) reasons.push('otherPending')
  if (facts.isProduction) reasons.push('production')
  return reasons
}

/** What a failed run becomes on the screen. */
export type RunFailed =
  /** It may have run: the result says so, and the history gets an unknown record at once. */
  | { kind: 'unknown' }
  /** Shown elsewhere (the org is gone, sf is missing): the result empties. */
  | { kind: 'elsewhere' }
  /** It did not run. `orgAuth`: the org's login has to be renewed. */
  | { kind: 'error'; message: string; details?: unknown; reloginCommand?: string; orgAuth: boolean }

export function runFailed(e: unknown, changesData: boolean): RunFailed {
  if (isOutcomeUnknown(e, changesData)) return { kind: 'unknown' }
  const failure = runFailure(e)
  if (!failure) return { kind: 'elsewhere' }
  return { kind: 'error', message: failure.message, details: failure.details, reloginCommand: failure.reloginCommand, orgAuth: failure.orgAuth }
}
