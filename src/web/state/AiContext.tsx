// The AI input, its requests and the proposal (docs/ai.md "画面の状態と遷移").
// Inside the workspace, which is remade for each org, so that switching orgs
// stops a request and drops the proposal. Kept apart from the SOQL state so
// that the AI's steps do not redraw the editor.
import { createContext, useCallback, useContext, useMemo, useReducer, useState, type ReactNode } from 'react'
import { availabilityOf, type AiAvailability } from '../ai/availability.ts'
import { initialState, reducer, type AiFailure, type AiStep, type Proposal } from '../ai/aiState.ts'
import { budgetLeft, objectInfo, objectList } from '../ai/objectInfo.ts'
import { ApiRequestError, api, type SObjectDescribe } from '../apiClient.ts'
import { t, uiLanguage } from '../i18n/i18n.ts'
import { fromObjectOf } from '../soql/context.ts'
import { findByName } from '../soql/namespace.ts'
import type { NameContext } from '../soql/selection.ts'
import { useApp } from './AppContext.tsx'
import { describeGlobal, describeSObject } from './describeCache.ts'
import { useOrgs } from './OrgContext.tsx'
import { usePanels } from './PanelsContext.tsx'
import { useSoql, type QueryResult } from './SoqlContext.tsx'
import { useTask, type TaskOutcome } from './useTask.ts'

export type { AiFailure, AiStep, Proposal } from '../ai/aiState.ts'

/** The query that Salesforce rejected, as it was run. */
export type Rejected = NonNullable<Extract<QueryResult, { state: 'error' }>['rejected']>

type AiValue = {
  availability: AiAvailability
  /** The provider and model, shown at the right of the input. */
  label: string
  request: string
  setRequest: (text: string) => void
  /** The object whose fields are sent (the one open on the left), unless removed. */
  objectChip: string | undefined
  removeObjectChip: () => void
  /** Whether the editor text is sent. */
  editorChip: boolean
  removeEditorChip: () => void
  /** A request is running: decided by the AI task only. */
  running: boolean
  step: AiStep | undefined
  /** Not shown while a request runs, or while the AI is Off or not set up. */
  proposal: Proposal | undefined
  failure: AiFailure | undefined
  generate: () => void
  /** Asks the AI to fix a query that Salesforce rejected, as it was run. */
  fix: (error: string, rejected: Rejected) => void
  cancel: () => void
  discard: () => void
  apply: (run: boolean) => void
}

const AiContext = createContext<AiValue | undefined>(undefined)

/** A message for the user from this screen, not an API error. */
class Notice extends Error {}

/** Below this much room for fields, the AI would write SOQL without knowing the fields. */
const MIN_FIELD_BUDGET = 2_000

type Progress = (step: AiStep) => void

/** Generate (docs/ai.md "Generate の流れ"). Reads only its arguments: the values when it was pressed. */
async function generateSoql(
  input: { username: string; request: string; object: string | undefined; editorText: string; tooling: boolean; names: NameContext },
  signal: AbortSignal,
  progress: Progress,
): Promise<Proposal> {
  const { username, request, object, editorText, tooling, names } = input
  progress(object ? 'loadFields' : 'chooseObjects')
  const fieldBudget = budgetLeft(request, editorText)
  if (fieldBudget < MIN_FIELD_BUDGET) throw new Notice(t.aiTooLong)
  const globals = (await describeGlobal(username, tooling)).sobjects
  const chosen = object ? findByName(globals, object, names.ns) : undefined
  let objects = chosen ? [chosen.name] : []
  if (objects.length === 0) {
    // Also when the open object is not in this API's list (such as after switching to the Tooling API).
    progress('chooseObjects')
    // No object open: the AI picks from the org's objects first.
    const { output } = await api.aiGenerate(
      { task: 'chooseObjects', input: { request, objects: objectList(globals, names, budgetLeft(request)), tooling, language: uiLanguage } },
      signal,
    )
    // The server has already matched the names with the list and dropped repeats.
    objects = output.objects.map((o) => findByName(globals, o, names.ns)?.name).filter((o): o is string => Boolean(o))
    if (objects.length === 0) throw new Notice(t.aiNoObjects)
    progress('loadFields')
  }
  const describes: SObjectDescribe[] = await Promise.all(objects.map((o) => describeSObject(username, o, tooling)))
  progress('generate')
  const { output } = await api.aiGenerate(
    { task: 'generateSoql', input: { request, objectInfo: objectInfo(describes, names, fieldBudget), editorText, tooling, language: uiLanguage } },
    signal,
  )
  return { ...output, tooling, prompt: request }
}

/** Fix with AI: the query as it was run, not what the editor holds now. */
async function fixSoql(
  input: { username: string; error: string; rejected: Rejected; names: NameContext },
  signal: AbortSignal,
  progress: Progress,
): Promise<Proposal> {
  const { username, error, names } = input
  const { soql, tooling, prompt } = input.rejected
  progress('loadFields')
  const fieldBudget = budgetLeft(soql, error)
  if (fieldBudget < MIN_FIELD_BUDGET) throw new Notice(t.aiTooLong)
  const globals = (await describeGlobal(username, tooling)).sobjects
  const from = fromObjectOf(soql)
  // An object the org does not have may be the error itself: then no fields are sent.
  const object = from ? findByName(globals, from, names.ns) : undefined
  const describes = object ? [await describeSObject(username, object.name, tooling)] : []
  progress('fix')
  const { output } = await api.aiGenerate(
    {
      task: 'fixSoql',
      input: { soql, error, objectInfo: describes.length ? objectInfo(describes, names, fieldBudget) : '', tooling, language: uiLanguage },
    },
    signal,
  )
  // The fixed query keeps the request of the query it fixes, if that one had one.
  return { ...output, tooling, prompt }
}

export function AiProvider({ username, children }: { username: string; children: ReactNode }) {
  const { settings } = useApp()
  const { handleOrgError } = useOrgs()
  const soql = useSoql()
  const { setOpen } = usePanels()
  // Generate and Fix both write the proposal, so they share one task. Ignore,
  // so that Enter pressed again does not send the request twice.
  const { start, cancel: cancelTask, running, progress: step } = useTask<AiStep>()
  const [state, dispatch] = useReducer(reducer, initialState)
  const [request, setRequest] = useState('')
  // A removed chip stays removed only while the same object, or the same first line, is there.
  const [removedObject, setRemovedObject] = useState<string>()
  const [removedFirstLine, setRemovedFirstLine] = useState<string>()

  const ai = settings?.ai
  const availability = availabilityOf(settings)
  const label = ai && ai.provider !== 'off' ? `${t.aiProviderName[ai.provider]} · ${ai.model}` : ''
  const objectChip = soql.panelObject && soql.panelObject !== removedObject ? soql.panelObject : undefined
  const editorChip = soql.firstLine.trim() !== '' && soql.firstLine !== removedFirstLine

  /** Applies a request's outcome (docs/ai.md "失敗したとき"). */
  const finish = useCallback(
    (outcome: TaskOutcome<Proposal>) => {
      if (outcome.kind === 'done') dispatch({ type: 'done', proposal: outcome.value })
      if (outcome.kind !== 'error') return
      const e = outcome.error
      let failure: AiFailure | undefined
      if (e instanceof Notice) failure = { message: e.message }
      // Org errors, a lost session and a missing sf CLI are shown app-wide.
      else if (e instanceof ApiRequestError) failure = handleOrgError(username, e) ? undefined : { message: e.message, details: e.body?.details }
      else failure = { message: (e as Error).message ?? String(e) }
      dispatch({ type: 'failed', failure })
    },
    [handleOrgError, username],
  )

  const generate = useCallback(() => {
    const text = request.trim()
    if (!text || availability !== 'ready') return
    const input = {
      username,
      request: text,
      object: objectChip,
      editorText: editorChip ? soql.getText() : '',
      tooling: soql.tooling,
      names: soql.names,
    }
    void start((signal, progress) => generateSoql(input, signal, progress), 'ignore').then(finish)
  }, [request, availability, username, objectChip, editorChip, soql, start, finish])

  const fix = useCallback(
    (error: string, rejected: Rejected) => {
      if (availability !== 'ready') return
      // The proposal shows above the editor.
      setOpen('editor', true)
      const input = { username, error, rejected, names: soql.names }
      void start((signal, progress) => fixSoql(input, signal, progress), 'ignore').then(finish)
    },
    [availability, setOpen, username, soql.names, start, finish],
  )

  const cancel = useCallback(() => {
    // Only a request that was stopped drops what is shown: a proposal arriving as Cancel is pressed stays.
    if (cancelTask()) dispatch({ type: 'cancelled' })
  }, [cancelTask])

  const { proposal, failure } = state
  const { applyProposal } = soql
  const apply = useCallback(
    (run: boolean) => {
      if (!proposal) return
      applyProposal(proposal, run)
      dispatch({ type: 'applied' })
    },
    [proposal, applyProposal],
  )

  const value = useMemo<AiValue>(
    () => ({
      availability,
      label,
      request,
      setRequest,
      objectChip,
      removeObjectChip: () => setRemovedObject(soql.panelObject),
      editorChip,
      removeEditorChip: () => setRemovedFirstLine(soql.firstLine),
      running,
      step,
      proposal: running || availability !== 'ready' ? undefined : proposal,
      failure: running ? undefined : failure,
      generate,
      fix,
      cancel,
      discard: () => dispatch({ type: 'discarded' }),
      apply,
    }),
    [availability, label, request, objectChip, editorChip, soql.panelObject, soql.firstLine, running, step, proposal, failure, generate, fix, cancel, apply],
  )
  return <AiContext.Provider value={value}>{children}</AiContext.Provider>
}

// The hook lives next to its provider; this file is not hot-reloaded as a component.
// oxlint-disable-next-line react/only-export-components
export function useAi(): AiValue {
  const value = useContext(AiContext)
  if (!value) throw new Error('useAi must be used inside AiProvider')
  return value
}
