// The AI proposal and failure as a reducer, apart from the provider so that
// it can be tested as the table in docs/ai.md "画面の状態と遷移". Whether a
// request is running is the AI task's, not kept here.
import type { SoqlOutput } from '../../shared/api.ts'

export type AiStep = 'chooseObjects' | 'loadFields' | 'generate' | 'fix'

export type Proposal = SoqlOutput & {
  /** The API the query was written for: it runs with this one. */
  tooling: boolean
  /** The request behind the query, recorded when it runs (docs/ai.md "要望の印"). */
  prompt: string | undefined
}

/** Shown under the AI input. */
export type AiFailure = { message: string; details?: unknown }

/** A proposal as shown: with the editor text when it arrived, which its differences are against. */
export type Shown = Proposal & { before: string }

export type State = { proposal: Shown | undefined; failure: AiFailure | undefined }

export type Action =
  | { type: 'done'; proposal: Shown }
  /** Without a failure, another place showed it (such as a lost session). */
  | { type: 'failed'; failure: AiFailure | undefined }
  /** Cancel that stopped a request. */
  | { type: 'cancelled' }
  | { type: 'discarded' }
  /** Replace, or Replace & Run. */
  | { type: 'applied' }

export const initialState: State = { proposal: undefined, failure: undefined }

export function reducer(state: State, action: Action): State {
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
