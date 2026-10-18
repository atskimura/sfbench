// The SOQL screen's AI (docs/ai.md "画面の状態と遷移"): what is sent and how a
// proposal is put in. What every screen's AI shares is useAiSession. Inside
// the workspace, which is remade for each org, so that switching orgs stops a
// request and drops the proposal. Kept apart from the SOQL state so that the
// AI's steps do not redraw the editor.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { AiStep, Proposal } from '../ai/aiState.ts'
import { budgetLeft, objectInfo, objectList } from '../ai/objectInfo.ts'
import { api, type SObjectDescribe } from '../apiClient.ts'
import { t, uiLanguage } from '../i18n/i18n.ts'
import { fromObjectOf } from '../soql/context.ts'
import { findByName } from '../soql/namespace.ts'
import type { NameContext } from '../soql/selection.ts'
import { describeGlobal, describeSObject } from './describeCache.ts'
import { usePanels } from './PanelsContext.tsx'
import { useSoql, type QueryResult } from './SoqlContext.tsx'
import { AiNotice, useAiSession, type AiSession } from './useAiSession.ts'

export type { AiFailure, AiStep, Proposal, Shown } from '../ai/aiState.ts'

/** The query that Salesforce rejected, as it was run. */
export type Rejected = NonNullable<Extract<QueryResult, { state: 'error' }>['rejected']>

type AiValue = AiSession<Proposal, AiStep> & {
  /** The object open on the left: a hint for the AI's choice of objects. */
  panelObject: string | undefined
  /** Whether the editor has text to send. */
  hasEditorText: boolean
  /** Whether the editor text is sent: unticking holds for this workspace. */
  sendEditor: boolean
  setSendEditor: (on: boolean) => void
  generate: () => void
  /** Asks the AI to fix a query that Salesforce rejected, as it was run. */
  fix: (error: string, rejected: Rejected) => void
  apply: (run: boolean) => void
}

const AiContext = createContext<AiValue | undefined>(undefined)

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
  if (fieldBudget < MIN_FIELD_BUDGET) throw new AiNotice(t.aiTooLong)
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
  if (objects.length === 0) throw new AiNotice(t.aiNoObjects)
  progress('loadFields')
  const describes: SObjectDescribe[] = await Promise.all(objects.map((o) => describeSObject(username, o, tooling, apiVersion)))
  progress('generate')
  const { output } = await api.aiGenerate(
    { task: 'generateSoql', input: { request, objectInfo: objectInfo(describes, names, fieldBudget), editorText, tooling, language: uiLanguage } },
    signal,
  )
  return { ...output, tooling, apiVersion, prompt: request }
}

/** Fix with AI: the query as it was run, not what the editor holds now. */
async function fixSoql(
  input: { username: string; error: string; rejected: Rejected; names: NameContext },
  signal: AbortSignal,
  progress: Progress,
): Promise<Proposal> {
  const { username, error, names } = input
  // The version it ran on, not the one chosen now.
  const { soql, tooling, apiVersion, prompt } = input.rejected
  progress('loadFields')
  const fieldBudget = budgetLeft(soql, error)
  if (fieldBudget < MIN_FIELD_BUDGET) throw new AiNotice(t.aiTooLong)
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
  return { ...output, tooling, apiVersion, prompt }
}

export function AiProvider({ username, children }: { username: string; children: ReactNode }) {
  const soql = useSoql()
  const { getText } = soql
  const { setOpen } = usePanels()
  const session = useAiSession<Proposal, AiStep>(username)
  // Unsent once the user says so, until the workspace goes (docs/ai.md "AI の入力欄").
  const [sendEditor, setSendEditor] = useState(true)
  const hasEditorText = soql.firstLine.trim() !== ''
  const editorChip = sendEditor && hasEditorText

  const { availability, request, start, proposal, applied } = session
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
    start((signal, progress) => generateSoql(input, signal, progress), getText)
  }, [request, availability, username, editorChip, soql, start, getText])

  const fix = useCallback(
    (error: string, rejected: Rejected) => {
      if (availability !== 'ready') return
      // The proposal shows above the editor.
      setOpen('editor', true)
      const input = { username, error, rejected, names: soql.names }
      start((signal, progress) => fixSoql(input, signal, progress), getText)
    },
    [availability, setOpen, username, soql.names, start, getText],
  )

  const { applyProposal } = soql
  const apply = useCallback(
    (run: boolean) => {
      if (!proposal) return
      applyProposal(proposal, run)
      applied()
    },
    [proposal, applyProposal, applied],
  )

  const value = useMemo<AiValue>(
    () => ({ ...session, panelObject: soql.panelObject, hasEditorText, sendEditor, setSendEditor, generate, fix, apply }),
    [session, soql.panelObject, hasEditorText, sendEditor, generate, fix, apply],
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
