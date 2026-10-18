// The AI proposal and failure as a reducer, apart from the providers so that
// it can be tested as the table in docs/ai.md "画面の状態と遷移". Whether a
// request is running is the AI task's, not kept here. The same for every
// screen; what a proposal holds is the screen's (P).
import type { SoqlOutput } from '../../shared/api.ts'

/** The SOQL screen's steps; another screen has its own. */
export type AiStep = 'chooseObjects' | 'loadFields' | 'generate' | 'fix'

/** The SOQL screen's proposal. */
export type Proposal = SoqlOutput & {
  /** The API the query was written for: it runs with this one. */
  tooling: boolean
  /** The API version whose objects and fields the AI was given: it runs on this one too. */
  apiVersion: string | undefined
  /** The request behind the query, recorded when it runs (docs/ai.md "要望の印"). */
  prompt: string | undefined
}

/** Shown under the AI input. */
export type AiFailure = { message: string; details?: unknown }

/** A proposal as shown: with the screen's text when it arrived, which its differences are against. */
export type Shown<P = Proposal> = P & { before: string }

export type State<P = Proposal> = { proposal: Shown<P> | undefined; failure: AiFailure | undefined }

export type Action<P = Proposal> =
  | { type: 'done'; proposal: Shown<P> }
  /** Without a failure, another place showed it (such as a lost session). */
  | { type: 'failed'; failure: AiFailure | undefined }
  /** Cancel that stopped a request. */
  | { type: 'cancelled' }
  | { type: 'discarded' }
  /** Replace, or Replace & Run. */
  | { type: 'applied' }

export const initialState: State<never> = { proposal: undefined, failure: undefined }

export function reducer<P>(state: State<P>, action: Action<P>): State<P> {
  switch (action.type) {
    case 'done':
      return { proposal: action.proposal, failure: undefined }
    case 'failed':
      return { proposal: undefined, failure: action.failure }
    case 'cancelled':
      return initialState
    case 'discarded':
    case 'applied':
      return { ...state, proposal: undefined }
  }
}
