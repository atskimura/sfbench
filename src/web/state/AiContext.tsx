// The SOQL screen's AI (docs/ai-agent.md "SOQL をそろえる"): what is sent and
// how a proposal is put in. The AI reads the org's metadata through tools on
// the server; what every screen's AI shares is useAiSession. Inside the
// workspace, which is remade for each org, so that switching orgs stops a
// request and drops the proposal. Kept apart from the SOQL state so that the
// AI's steps do not redraw the editor.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { AiStep, Proposal } from '../ai/aiState.ts'
import { api } from '../apiClient.ts'
import { uiLanguage } from '../i18n/i18n.ts'
import { fromObjectOf } from '../soql/context.ts'
import { usePanels } from './PanelsContext.tsx'
import { useSoql, type QueryResult } from './SoqlContext.tsx'
import { browserTimeZone, useAiSession, type AiSession } from './useAiSession.ts'

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
    // The values when it was pressed: the body reads only these.
    const { tooling, apiVersion, panelObject } = soql
    const editor = editorChip ? soql.getText() : ''
    const input = {
      request: text,
      tooling,
      language: uiLanguage,
      timeZone: browserTimeZone(),
      ...(editor.trim() ? { editor } : {}),
      // The open object is a hint only: the AI still chooses (docs/ai-agent.md "タスク").
      ...(panelObject ? { openObject: panelObject } : {}),
    }
    start(async (signal, progress) => {
      progress('think')
      const { output } = await api.aiAgent(username, { task: 'generateSoql', input, ...(apiVersion ? { apiVersion } : {}) }, signal)
      return { ...output, tooling, apiVersion, prompt: text }
    }, getText)
  }, [request, availability, username, editorChip, soql, start, getText])

  const fix = useCallback(
    (error: string, rejected: Rejected) => {
      if (availability !== 'ready') return
      // The proposal shows above the editor.
      setOpen('editor', true)
      // The query as it was run, on its API and version, not what the editor holds now.
      const { soql: query, tooling, apiVersion, prompt } = rejected
      const object = fromObjectOf(query)
      const input = { soql: query, error, tooling, language: uiLanguage, timeZone: browserTimeZone(), ...(object ? { object } : {}) }
      start(async (signal, progress) => {
        progress('think')
        const { output } = await api.aiAgent(username, { task: 'fixSoql', input, ...(apiVersion ? { apiVersion } : {}) }, signal)
        // The fixed query keeps the request of the query it fixes, if that one had one.
        return { ...output, tooling, apiVersion, prompt }
      }, getText)
    },
    [availability, setOpen, username, start, getText],
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
