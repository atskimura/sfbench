// The AI input, its requests and the proposal (docs/ai.md "画面の状態と遷移").
// Inside the workspace, which is remade for each org, so that switching orgs
// stops a request and drops the proposal. Kept apart from the SOQL state so
// that the AI's steps do not redraw the editor.
import { createContext, useCallback, useContext, useMemo, useReducer, useState, type ReactNode } from 'react'
import { availabilityOf, type AiAvailability } from '../ai/availability.ts'
import { initialState, reducer, type AiFailure, type AiStep, type Proposal, type Shown } from '../ai/aiState.ts'
import { budgetLeft, objectInfo, objectList } from '../ai/objectInfo.ts'
import { api, type SObjectDescribe } from '../apiClient.ts'
import { errorDetails, errorKind, errorMessage, isShownElsewhere } from '../errors.ts'
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

export type { AiFailure, AiStep, Proposal, Shown } from '../ai/aiState.ts'

/** The query that Salesforce rejected, as it was run. */
export type Rejected = NonNullable<Extract<QueryResult, { state: 'error' }>['rejected']>

type AiValue = {
  availability: AiAvailability
  /** The provider and model, shown at the right of the input. */
  label: string
  request: string
  setRequest: (text: string) => void
  /** The object open on the left: a hint for the AI's choice of objects. */
  panelObject: string | undefined
  /** Whether the editor has text to send. */
  hasEditorText: boolean
  /** Whether the editor text is sent: unticking holds for this workspace. */
  sendEditor: boolean
  setSendEditor: (on: boolean) => void
  /** A request is running: decided by the AI task only. */
  running: boolean
  step: AiStep | undefined
  /** Not shown while a request runs, or while the AI is Off or not set up. */
  proposal: Shown | undefined
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

/**
 * Generate (docs/ai.md "Generate の流れ"): the AI first chooses the objects,
 * with the open one as a hint only, so that it does not write the query for
 * the open object when the request is about another. Reads only its
 * arguments: the values when it was pressed.
 */
async function generateSoql(
  input: {
    username: string
    request: string
    openObject: string | undefined
    editorText: string
    tooling: boolean
    apiVersion: string | undefined
    names: NameContext
  },
  signal: AbortSignal,
  progress: Progress,
): Promise<Proposal> {
  const { username, request, openObject, editorText, tooling, apiVersion, names } = input
  progress('chooseObjects')
  const fieldBudget = budgetLeft(request, editorText)
  if (fieldBudget < MIN_FIELD_BUDGET) throw new Notice(t.aiTooLong)
  const globals = (await describeGlobal(username, tooling, apiVersion)).sobjects
  // Only an object in this API's list is a hint (not one open before switching to the Tooling API).
  const open = openObject ? findByName(globals, openObject, names.ns)?.name : undefined
  const { output: chosen } = await api.aiGenerate(
    {
      task: 'chooseObjects',
      input: { request, objects: objectList(globals, names, budgetLeft(request)), ...(open ? { openObject: open } : {}), tooling, language: uiLanguage },
    },
    signal,
  )
  // Back to the names as the list holds them (the server matched them with the list,
  // ignoring case and namespace, and dropped repeats).
  const objects = chosen.objects.map((o) => findByName(globals, o, names.ns)?.name).filter((o): o is string => Boolean(o))
  if (objects.length === 0) throw new Notice(t.aiNoObjects)
  progress('loadFields')
  const describes: SObjectDescribe[] = await Promise.all(objects.map((o) => describeSObject(username, o, tooling, apiVersion)))
  progress('generate')
  const { output } = await api.aiGenerate(
    { task: 'generateSoql', input: { request, objectInfo: objectInfo(describes, names, fieldBudget), editorText, tooling, language: uiLanguage } },
    signal,
  )
  return { ...output, tooling, prompt: request }
}

/** Fix with AI: the query as it was run, not what the editor holds now. */
async function fixSoql(
  input: { username: string; error: string; rejected: Rejected; apiVersion: string | undefined; names: NameContext },
  signal: AbortSignal,
  progress: Progress,
): Promise<Proposal> {
  const { username, error, apiVersion, names } = input
  const { soql, tooling, prompt } = input.rejected
  progress('loadFields')
  const fieldBudget = budgetLeft(soql, error)
  if (fieldBudget < MIN_FIELD_BUDGET) throw new Notice(t.aiTooLong)
  const globals = (await describeGlobal(username, tooling, apiVersion)).sobjects
  const from = fromObjectOf(soql)
  // An object the org does not have may be the error itself: then no fields are sent.
  const object = from ? findByName(globals, from, names.ns) : undefined
  const describes = object ? [await describeSObject(username, object.name, tooling, apiVersion)] : []
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
  const { getText } = soql
  const { setOpen } = usePanels()
  // Generate and Fix both write the proposal, so they share one task. Ignore,
  // so that Enter pressed again does not send the request twice.
  const { start, cancel: cancelTask, running, progress: step } = useTask<AiStep>()
  const [state, dispatch] = useReducer(reducer, initialState)
  const [request, setRequest] = useState('')
  // Unsent once the user says so, until the workspace goes (docs/ai.md "AI の入力欄").
  const [sendEditor, setSendEditor] = useState(true)

  const ai = settings?.ai
  const availability = availabilityOf(settings)
  const label = ai && ai.provider !== 'off' ? `${t.aiProviderName[ai.provider]} · ${ai.model}` : ''
  const hasEditorText = soql.firstLine.trim() !== ''
  const editorChip = sendEditor && hasEditorText

  /** Applies a request's outcome (docs/ai.md "失敗したとき"). */
  const finish = useCallback(
    (outcome: TaskOutcome<Proposal>) => {
      // The differences are against the editor as it is when the proposal arrives (docs/ai.md "提案カード").
      if (outcome.kind === 'done') dispatch({ type: 'done', proposal: { ...outcome.value, before: getText() } })
      if (outcome.kind !== 'error') return
      const e = outcome.error
      // Org errors, a lost session and a missing sf CLI are shown app-wide; the rest under the input.
      const failure: AiFailure | undefined =
        !(e instanceof Notice) && isShownElsewhere(errorKind(e))
          ? undefined
          : { message: errorMessage(e), details: errorDetails(e) }
      if (!failure) handleOrgError(username, e)
      dispatch({ type: 'failed', failure })
    },
    [handleOrgError, username, getText],
  )

  const generate = useCallback(() => {
    const text = request.trim()
    if (!text || availability !== 'ready') return
    const input = {
      username,
      request: text,
      openObject: soql.panelObject,
      editorText: editorChip ? soql.getText() : '',
      tooling: soql.tooling,
      apiVersion: soql.apiVersion,
      names: soql.names,
    }
    void start((signal, progress) => generateSoql(input, signal, progress), 'ignore').then(finish)
  }, [request, availability, username, editorChip, soql, start, finish])

  const fix = useCallback(
    (error: string, rejected: Rejected) => {
      if (availability !== 'ready') return
      // The proposal shows above the editor.
      setOpen('editor', true)
      const input = { username, error, rejected, apiVersion: soql.apiVersion, names: soql.names }
      void start((signal, progress) => fixSoql(input, signal, progress), 'ignore').then(finish)
    },
    [availability, setOpen, username, soql.names, soql.apiVersion, start, finish],
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
      panelObject: soql.panelObject,
      hasEditorText,
      sendEditor,
      setSendEditor,
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
    [availability, label, request, hasEditorText, sendEditor, soql.panelObject, running, step, proposal, failure, generate, fix, cancel, apply],
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
