// The AI input, its flow and the proposal (docs/ai.md "画面"). Kept apart
// from the SOQL state so that typing a request does not redraw the editor.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SoqlOutput } from '../../shared/api.ts'
import { availabilityOf, type AiAvailability } from '../ai/availability.ts'
import { ApiRequestError, api, type SObjectDescribe } from '../apiClient.ts'
import { budgetLeft, objectInfo, objectList } from '../ai/objectInfo.ts'
import { t, uiLanguage } from '../i18n/i18n.ts'
import { fromObjectOf } from '../soql/context.ts'
import { findByName } from '../soql/namespace.ts'
import { useApp } from './AppContext.tsx'
import { describeGlobal, describeSObject } from './describeCache.ts'
import { useOrgs } from './OrgContext.tsx'
import { useSoql } from './SoqlContext.tsx'


export type AiStep = 'chooseObjects' | 'loadFields' | 'generate' | 'fix'

export type AiStatus =
  | { state: 'idle' }
  | { state: 'running'; step: AiStep }
  | { state: 'error'; message: string; details?: unknown }

export type Proposal = SoqlOutput & {
  /** The editor text when the AI was asked, for the diff. */
  before: string
  /** The request behind the proposal, recorded with the query when it runs. */
  prompt: string | undefined
  /** Whether the query is for the Tooling API. */
  tooling: boolean
}

type AiState = {
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
  status: AiStatus
  proposal: Proposal | undefined
  generate: () => void
  /** Asks the AI to fix a query that Salesforce rejected, as it was run. */
  fix: (error: string, soql: string, tooling: boolean) => void
  cancel: () => void
  discard: () => void
  apply: (run: boolean) => void
}

const AiContext = createContext<AiState | undefined>(undefined)

/** A message for the user, not an API error. */
class Notice extends Error {}

/** Below this much room for fields, the AI would write SOQL without knowing the fields. */
const MIN_FIELD_BUDGET = 2_000

export function AiProvider({ children }: { children: ReactNode }) {
  const { settings, handleCommonError } = useApp()
  const { selected } = useOrgs()
  const soql = useSoql()
  const [request, setRequest] = useState('')
  // A removed chip stays removed only while the same object, or the same editor text, is there.
  const [removedObject, setRemovedObject] = useState<string>()
  const [removedEditorText, setRemovedEditorText] = useState<string>()
  // One flow runs at a time; its status and proposal are tagged with its org, so
  // that after switching orgs what was asked of the old one is not shown.
  const [statusOf, setStatusOf] = useState<{ org: string | undefined; status: AiStatus }>({ org: undefined, status: { state: 'idle' } })
  const [proposalOf, setProposalOf] = useState<{ org: string | undefined; proposal: Proposal }>()
  const status = useMemo<AiStatus>(() => (statusOf.org === selected ? statusOf.status : { state: 'idle' }), [statusOf, selected])
  const proposal = proposalOf && proposalOf.org === selected ? proposalOf.proposal : undefined
  const flow = useRef<AbortController | undefined>(undefined)

  const ai = settings?.ai
  const availability = availabilityOf(settings)
  const label = ai && ai.provider !== 'off' ? `${t.aiProviderName[ai.provider]} · ${ai.model}` : ''
  const objectChip = soql.panelObject && soql.panelObject !== removedObject ? soql.panelObject : undefined
  const editorChip = soql.firstLine.trim() !== '' && soql.firstLine !== removedEditorText

  // Another org: the running flow stops, and nothing stays "running".
  useEffect(
    () => () => {
      flow.current?.abort()
      setStatusOf((prev) => (prev.status.state === 'running' ? { ...prev, status: { state: 'idle' } } : prev))
    },
    [selected],
  )

  /**
   * Runs one flow; a newer flow or Cancel stops the older one. The flow
   * reports its steps through `step`, which does nothing once it is stopped,
   * so a stopped flow never overwrites what a newer one shows. The first step
   * shows at once, so that Generate cannot be pressed twice meanwhile.
   */
  const start = useCallback(
    (firstStep: AiStep, body: (signal: AbortSignal, step: (s: AiStep) => void) => Promise<Proposal>) => {
      flow.current?.abort()
      const abort = new AbortController()
      flow.current = abort
      const org = selected
      const set = (status: AiStatus) => {
        if (!abort.signal.aborted) setStatusOf({ org, status })
      }
      setProposalOf(undefined)
      set({ state: 'running', step: firstStep })
      body(abort.signal, (step) => set({ state: 'running', step })).then(
        (p) => {
          if (abort.signal.aborted) return
          setProposalOf({ org, proposal: p })
          set({ state: 'idle' })
        },
        (e: unknown) => {
          if (abort.signal.aborted || (e instanceof ApiRequestError && e.code === 'ABORTED')) return
          // A lost session or a missing sf CLI is shown app-wide; everything else under the AI input.
          if (e instanceof ApiRequestError && handleCommonError(e)) {
            set({ state: 'idle' })
            return
          }
          const details = e instanceof ApiRequestError ? e.body?.details : undefined
          set({ state: 'error', message: (e as Error).message, details })
        },
      )
    },
    [handleCommonError, selected],
  )

  const generate = useCallback(() => {
    const username = selected
    const text = request.trim()
    if (!username || !text || availability !== 'ready') return
    const { tooling, names } = soql
    const editorText = editorChip ? soql.getText() : ''
    start(objectChip ? 'loadFields' : 'chooseObjects', async (signal, step) => {
      const fieldBudget = budgetLeft(text, editorText)
      if (fieldBudget < MIN_FIELD_BUDGET) throw new Notice(t.aiTooLong)
      const globals = (await describeGlobal(username, tooling)).sobjects
      const chosen = objectChip ? findByName(globals, objectChip, names.ns) : undefined
      let objects = chosen ? [chosen.name] : []
      if (objects.length === 0) {
        // No object open: the AI picks from the org's objects first (docs/ai.md "Generate の流れ").
        const { output } = await api.aiGenerate(
          { task: 'chooseObjects', input: { request: text, objects: objectList(globals, names, budgetLeft(text)), tooling, language: uiLanguage } },
          signal,
        )
        objects = output.objects.map((o) => findByName(globals, o, names.ns)?.name).filter((o): o is string => Boolean(o))
        if (objects.length === 0) throw new Notice(t.aiNoObjects)
        step('loadFields')
      }
      const describes: SObjectDescribe[] = await Promise.all(objects.map((o) => describeSObject(username, o, tooling)))
      step('generate')
      const { output } = await api.aiGenerate(
        { task: 'generateSoql', input: { request: text, objectInfo: objectInfo(describes, names, fieldBudget), editorText, tooling, language: uiLanguage } },
        signal,
      )
      // The diff is against the editor as it is when the proposal arrives: Replace replaces that.
      return { ...output, before: soql.getText(), prompt: text, tooling }
    })
  }, [selected, request, availability, soql, editorChip, objectChip, start])

  const fix = useCallback(
    (error: string, failed: string, tooling: boolean) => {
      const username = selected
      if (!username || availability !== 'ready') return
      const { names } = soql
      // Taken now, before the user may load or replace other queries while waiting.
      const prompt = soql.promptFor(failed)
      // The query and API of the run that failed, not what the editor holds now.
      start('fix', async (signal) => {
        const fieldBudget = budgetLeft(failed, error)
        if (fieldBudget < MIN_FIELD_BUDGET) throw new Notice(t.aiTooLong)
        const globals = (await describeGlobal(username, tooling)).sobjects
        const from = fromObjectOf(failed)
        // An object the org does not have may be the error itself: then no fields are sent.
        const object = from ? findByName(globals, from, names.ns) : undefined
        const describes = object ? [await describeSObject(username, object.name, tooling)] : []
        const { output } = await api.aiGenerate(
          {
            task: 'fixSoql',
            input: { soql: failed, error, objectInfo: describes.length ? objectInfo(describes, names, fieldBudget) : '', tooling, language: uiLanguage },
          },
          signal,
        )
        return { ...output, before: soql.getText(), prompt, tooling }
      })
    },
    [selected, availability, soql, start],
  )

  const value = useMemo<AiState>(
    () => ({
      availability,
      label,
      request,
      setRequest,
      objectChip,
      removeObjectChip: () => setRemovedObject(soql.panelObject),
      editorChip,
      removeEditorChip: () => setRemovedEditorText(soql.firstLine),
      status,
      proposal,
      generate,
      fix,
      cancel: () => {
        flow.current?.abort()
        setStatusOf({ org: selected, status: { state: 'idle' } })
      },
      discard: () => setProposalOf(undefined),
      apply: (run) => {
        if (!proposal) return
        // The proposal runs with the API it was written for.
        if (proposal.tooling !== soql.tooling) soql.setTooling(proposal.tooling)
        soql.applyProposal(proposal.soql, proposal.prompt)
        setProposalOf(undefined)
        if (run) soql.run(proposal.tooling)
      },
    }),
    [availability, label, request, objectChip, editorChip, status, proposal, generate, fix, soql, selected],
  )
  return <AiContext.Provider value={value}>{children}</AiContext.Provider>
}

// The hook lives next to its provider; this file is not hot-reloaded as a component.
// oxlint-disable-next-line react/only-export-components
export function useAi(): AiState {
  const value = useContext(AiContext)
  if (!value) throw new Error('useAi must be used inside AiProvider')
  return value
}
