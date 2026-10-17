// The AI input, its flow and the proposal (docs/ai.md "画面"). Kept apart
// from the SOQL state so that typing a request does not redraw the editor.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SoqlOutput } from '../../shared/api.ts'
import { availabilityOf, type AiAvailability } from '../ai/availability.ts'
import { ApiRequestError, api, type SObjectDescribe } from '../apiClient.ts'
import { objectInfo, objectList } from '../ai/objectInfo.ts'
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
  fix: (error: string) => void
  cancel: () => void
  discard: () => void
  apply: (run: boolean) => void
}

const AiContext = createContext<AiState | undefined>(undefined)

/** A message for the user, not an API error. */
class Notice extends Error {}

export function AiProvider({ children }: { children: ReactNode }) {
  const { settings, handleCommonError } = useApp()
  const { selected } = useOrgs()
  const soql = useSoql()
  const [request, setRequest] = useState('')
  const [removedObject, setRemovedObject] = useState<string>()
  const [editorRemoved, setEditorRemoved] = useState(false)
  // Each tagged with its org: after switching orgs, what was asked of the old one is not shown.
  const [statusOf, setStatusOf] = useState<{ org: string | undefined; status: AiStatus }>({ org: undefined, status: { state: 'idle' } })
  const [proposalOf, setProposalOf] = useState<{ org: string | undefined; proposal: Proposal }>()
  const status = useMemo<AiStatus>(() => (statusOf.org === selected ? statusOf.status : { state: 'idle' }), [statusOf, selected])
  const proposal = proposalOf && proposalOf.org === selected ? proposalOf.proposal : undefined
  const setStatus = useCallback((s: AiStatus) => setStatusOf({ org: selected, status: s }), [selected])
  const setProposal = useCallback((p: Proposal | undefined) => setProposalOf(p && { org: selected, proposal: p }), [selected])
  const flow = useRef<AbortController | undefined>(undefined)

  const ai = settings?.ai
  const availability = availabilityOf(ai)
  const label = ai && ai.provider !== 'off' ? `${t.aiProviderName[ai.provider]} · ${ai.model}` : ''
  const objectChip = soql.panelObject && soql.panelObject !== removedObject ? soql.panelObject : undefined
  const editorChip = soql.firstLine.trim() !== '' && !editorRemoved

  // Another org: the flow for the old one stops (what it showed is hidden by the org tags above).
  useEffect(() => () => flow.current?.abort(), [selected])

  /** Runs one flow; a newer flow or Cancel stops the older one. */
  const start = useCallback(
    (body: (signal: AbortSignal) => Promise<Proposal>) => {
      flow.current?.abort()
      const abort = new AbortController()
      flow.current = abort
      setProposal(undefined)
      body(abort.signal).then(
        (p) => {
          if (abort.signal.aborted) return
          setProposal(p)
          setStatus({ state: 'idle' })
        },
        (e: unknown) => {
          if (abort.signal.aborted || (e instanceof ApiRequestError && e.code === 'ABORTED')) return
          // A lost session or a missing sf CLI is shown app-wide; everything else under the AI input.
          if (e instanceof ApiRequestError && handleCommonError(e)) {
            setStatus({ state: 'idle' })
            return
          }
          const details = e instanceof ApiRequestError ? e.body?.details : undefined
          setStatus({ state: 'error', message: (e as Error).message, details })
        },
      )
    },
    [handleCommonError, setStatus, setProposal],
  )

  const generate = useCallback(() => {
    const username = selected
    const text = request.trim()
    if (!username || !text || availability !== 'ready') return
    const { tooling, names } = soql
    const sendEditor = editorChip
    start(async (signal) => {
      const globals = (await describeGlobal(username, tooling)).sobjects
      const chosen = objectChip ? findByName(globals, objectChip, names.ns) : undefined
      let objects = chosen ? [chosen.name] : []
      if (objects.length === 0) {
        // No object open: the AI picks from the org's objects first (docs/ai.md "Generate の流れ").
        setStatus({ state: 'running', step: 'chooseObjects' })
        const { output } = await api.aiGenerate(
          { task: 'chooseObjects', input: { request: text, objects: objectList(globals, names), tooling, language: uiLanguage } },
          signal,
        )
        objects = output.objects.map((o) => findByName(globals, o, names.ns)?.name).filter((o): o is string => Boolean(o))
        if (objects.length === 0) throw new Notice(t.aiNoObjects)
      }
      setStatus({ state: 'running', step: 'loadFields' })
      const describes: SObjectDescribe[] = await Promise.all(objects.map((o) => describeSObject(username, o, tooling)))
      setStatus({ state: 'running', step: 'generate' })
      const before = soql.getText()
      const { output } = await api.aiGenerate(
        {
          task: 'generateSoql',
          input: { request: text, objectInfo: objectInfo(describes, names), editorText: sendEditor ? before : '', tooling, language: uiLanguage },
        },
        signal,
      )
      return { ...output, before, prompt: text }
    })
  }, [selected, request, availability, soql, editorChip, objectChip, start, setStatus])

  const fix = useCallback(
    (error: string) => {
      const username = selected
      if (!username || availability !== 'ready') return
      const { tooling, names } = soql
      start(async (signal) => {
        setStatus({ state: 'running', step: 'fix' })
        const before = soql.getText()
        const globals = (await describeGlobal(username, tooling)).sobjects
        const from = fromObjectOf(before)
        // An object the org does not have may be the error itself: then no fields are sent.
        const object = from ? findByName(globals, from, names.ns) : undefined
        const describes = object ? [await describeSObject(username, object.name, tooling)] : []
        const { output } = await api.aiGenerate(
          {
            task: 'fixSoql',
            input: { soql: before, error, objectInfo: describes.length ? objectInfo(describes, names) : '', tooling, language: uiLanguage },
          },
          signal,
        )
        // A query the AI wrote keeps its request (docs/ai.md "最近のクエリへの記録").
        return { ...output, before, prompt: soql.promptFor(before) }
      })
    },
    [selected, availability, soql, start, setStatus],
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
      removeEditorChip: () => setEditorRemoved(true),
      status,
      proposal,
      generate,
      fix,
      cancel: () => {
        flow.current?.abort()
        setStatus({ state: 'idle' })
      },
      discard: () => setProposal(undefined),
      apply: (run) => {
        if (!proposal) return
        soql.applyProposal(proposal.soql, proposal.prompt)
        setProposal(undefined)
        setEditorRemoved(false)
        if (run) soql.run()
      },
    }),
    [availability, label, request, objectChip, editorChip, status, proposal, generate, fix, soql, setStatus, setProposal],
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
