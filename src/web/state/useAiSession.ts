// What every screen's AI shares (docs/ai.md "画面の状態と遷移"): whether the
// AI can be used, the request typed, one task for its requests, the proposal
// and the failure, Cancel and Discard. What is sent and how a proposal is used
// is the screen's own provider (AiContext for SOQL).
import { useCallback, useMemo, useReducer, useState } from 'react'
import { availabilityOf, type AiAvailability } from '../ai/availability.ts'
import { initialState, reducer, type AiFailure, type Shown, type State } from '../ai/aiState.ts'
import { errorDetails, errorKind, errorMessage, isShownElsewhere } from '../errors.ts'
import { t } from '../i18n/i18n.ts'
import { useApp } from './AppContext.tsx'
import { useOrgs } from './OrgContext.tsx'
import { useTask } from './useTask.ts'

/** A message for the user from the screen, not an API error: shown under the input as it is. */
export class AiNotice extends Error {}

export type AiSession<P, Step extends string> = {
  availability: AiAvailability
  /** The provider and model, shown at the right of the input. */
  label: string
  request: string
  setRequest: (text: string) => void
  /** A request is running: decided by the AI task only. */
  running: boolean
  step: Step | undefined
  /** Not shown while a request runs, or while the AI is Off or not set up. */
  proposal: Shown<P> | undefined
  failure: AiFailure | undefined
  /**
   * Starts a request, unless one runs (Enter pressed again sends nothing).
   * The body reads only its arguments: the values when it was pressed.
   * `before` reads the screen's text when the proposal arrives, which its
   * differences are against (docs/ai.md "提案カード").
   */
  start: (body: (signal: AbortSignal, progress: (step: Step) => void) => Promise<P>, before: () => string) => void
  cancel: () => void
  discard: () => void
  /** The proposal was put in: the card goes. */
  applied: () => void
}

export function useAiSession<P, Step extends string>(username: string): AiSession<P, Step> {
  const { settings } = useApp()
  const { handleOrgError } = useOrgs()
  // Generate and Fix both write the proposal, so they share one task. Ignore,
  // so that Enter pressed again does not send the request twice.
  const { start: startTask, cancel: cancelTask, running, progress: step } = useTask<Step>()
  const [state, dispatch] = useReducer(reducer<P>, initialState as State<P>)
  const [request, setRequest] = useState('')

  const ai = settings?.ai
  const availability = availabilityOf(settings)
  const label = ai && ai.provider !== 'off' ? `${t.aiProviderName[ai.provider]} · ${ai.model}` : ''

  const start = useCallback(
    (body: (signal: AbortSignal, progress: (step: Step) => void) => Promise<P>, before: () => string) => {
      void startTask(body, 'ignore').then((outcome) => {
        if (outcome.kind === 'done') dispatch({ type: 'done', proposal: { ...outcome.value, before: before() } })
        if (outcome.kind !== 'error') return
        const e = outcome.error
        // Org errors, a lost session and a missing sf CLI are shown app-wide; the rest under the input.
        const failure: AiFailure | undefined =
          !(e instanceof AiNotice) && isShownElsewhere(errorKind(e)) ? undefined : { message: errorMessage(e), details: errorDetails(e) }
        if (!failure) handleOrgError(username, e)
        dispatch({ type: 'failed', failure })
      })
    },
    [startTask, handleOrgError, username],
  )

  const cancel = useCallback(() => {
    // Only a request that was stopped drops what is shown: a proposal arriving as Cancel is pressed stays.
    if (cancelTask()) dispatch({ type: 'cancelled' })
  }, [cancelTask])
  const discard = useCallback(() => dispatch({ type: 'discarded' }), [])
  const applied = useCallback(() => dispatch({ type: 'applied' }), [])

  // One object per change, so that the providers' values change only when it does.
  return useMemo(
    () => ({
      availability,
      label,
      request,
      setRequest,
      running,
      step,
      proposal: running || availability !== 'ready' ? undefined : state.proposal,
      failure: running ? undefined : state.failure,
      start,
      cancel,
      discard,
      applied,
    }),
    [availability, label, request, running, step, state, start, cancel, discard, applied],
  )
}
