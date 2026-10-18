// The REST API screen's result, the confirmation and the launch notice as a
// reducer, so that it can be tested as the table in docs/rest.md "状態と遷移".
// Whether a request is being sent is the send task's, not kept here.
import type { RestResponse } from '../../shared/api.ts'
import type { ConfirmReason } from '../execution.ts'
import type { RestSnapshot } from './request.ts'

export type RestResult =
  | { state: 'idle' }
  /** Salesforce answered, whatever its status. */
  | { state: 'response'; request: RestSnapshot; response: RestResponse }
  /** The request was not sent, or failed in a way that tells it was not processed. */
  | { state: 'error'; request: RestSnapshot; message: string; details?: unknown; reloginCommand?: string }
  /** Salesforce may or may not have processed it. */
  | { state: 'unknown'; request: RestSnapshot; message: string }

export type State = {
  result: RestResult
  confirming: { request: RestSnapshot; reasons: ConfirmReason[] } | undefined
  /** The request came from the command line (--rest) and was not sent. */
  launchNotice: boolean
}

export type Action =
  | { type: 'confirm'; request: RestSnapshot; reasons: ConfirmReason[] }
  | { type: 'confirmCancelled' }
  /** Sending starts: the confirmation and the launch notice go. */
  | { type: 'sending' }
  | { type: 'result'; result: RestResult }
  /** Cancel stopped a request that changes no data. */
  | { type: 'cancelled' }
  | { type: 'noticeClosed' }

export function initialState(launched: boolean): State {
  return { result: { state: 'idle' }, confirming: undefined, launchNotice: launched }
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'confirm':
      return { ...state, confirming: { request: action.request, reasons: action.reasons } }
    case 'confirmCancelled':
      return { ...state, confirming: undefined }
    case 'sending':
      return { ...state, confirming: undefined, launchNotice: false }
    case 'result':
      return { ...state, result: action.result }
    case 'cancelled':
      return { ...state, result: { state: 'idle' } }
    case 'noticeClosed':
      return { ...state, launchNotice: false }
  }
}
