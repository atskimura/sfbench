// The Apex screen's result, the confirmation and the launch notice as a
// reducer, so that it can be tested as the table in docs/apex.md "実行の流れ".
// Whether Apex is running is the run task's, not kept here.
import type { ApexResponse } from '../../shared/api.ts'
import type { ConfirmReason } from '../execution.ts'

/** The code as it was when Run was pressed, and when. */
export type ApexSnapshot = { code: string; ranAt: string }

export type ApexResult =
  | { state: 'idle' }
  /** Salesforce answered: it ran, did not compile, or threw. */
  | { state: 'response'; run: ApexSnapshot; response: ApexResponse }
  /** It did not run. */
  | { state: 'error'; run: ApexSnapshot; message: string; details?: unknown; reloginCommand?: string }
  /** Salesforce may or may not have run it. */
  | { state: 'unknown'; run: ApexSnapshot; message: string }

export type State = {
  result: ApexResult
  confirming: { code: string; reasons: ConfirmReason[] } | undefined
  /** The code came from the command line (--apex) and was not run. */
  launchNotice: boolean
}

export type Action =
  | { type: 'confirm'; code: string; reasons: ConfirmReason[] }
  | { type: 'confirmCancelled' }
  /** Running starts: the confirmation and the launch notice go. */
  | { type: 'running' }
  | { type: 'result'; result: ApexResult }
  | { type: 'noticeClosed' }

export function initialState(launched: boolean): State {
  return { result: { state: 'idle' }, confirming: undefined, launchNotice: launched }
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'confirm':
      return { ...state, confirming: { code: action.code, reasons: action.reasons } }
    case 'confirmCancelled':
      return { ...state, confirming: undefined }
    case 'running':
      return { ...state, confirming: undefined, launchNotice: false }
    case 'result':
      return { ...state, result: action.result }
    case 'noticeClosed':
      return { ...state, launchNotice: false }
  }
}

/** The first line that is not blank, shown when the code area is closed. */
export function firstLineOf(code: string): string {
  return code.split('\n').find((line) => line.trim())?.trim() ?? ''
}
