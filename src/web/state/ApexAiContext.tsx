// The Apex screen's AI (docs/ai-agent.md "画面"): the AI writes anonymous
// Apex while reading the org's metadata through tools on the server. What
// every screen's AI shares is useAiSession; this holds what is sent and how a
// proposal is put in. Inside the workspace, which is remade for each org.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { AgentPreviousApex, ApexProposalOutput, ApexResponse } from '../../shared/api.ts'
import { userDebugOnly } from '../apex/log.ts'
import { cutRunText } from '../ai/cut.ts'
import { api } from '../apiClient.ts'
import { uiLanguage } from '../i18n/i18n.ts'
import { useApex } from './ApexContext.tsx'
import type { AgentStep } from './RestAiContext.tsx'
import { useAiSession, type AiSession } from './useAiSession.ts'

type ApexAiValue = AiSession<ApexProposalOutput, AgentStep> & {
  /** Whether the editor has code to send. */
  hasCode: boolean
  /** Whether the code now is sent: unticking holds for this workspace. */
  sendCode: boolean
  setSendCode: (on: boolean) => void
  /** Whether there is a result to send. */
  hasPrevious: boolean
  /** Whether the last result is sent: off unless chosen, as it can hold record values (docs/ai-agent.md "前の結果"). */
  sendPrevious: boolean
  setSendPrevious: (on: boolean) => void
  /** From the result's button: sends the last result, and draws the eyes up to the AI input (or stops sending it). */
  takeResult: (on: boolean) => void
  /** Counts takeResult(true), for the AI input to take the focus and flash. */
  attention: number
  generate: () => void
  /** Asks the AI to fix code that did not compile or threw, as it was run. */
  fix: (failed: { code: string; problem: string; line?: number; column?: number }) => void
  /** Puts the proposal in the editor as one undoable change. Never runs it. */
  apply: () => void
}

const ApexAiContext = createContext<ApexAiValue | undefined>(undefined)

/** The last run as sent to the AI: how it ended, and what System.debug wrote (the rest of the log is long and says little). */
function previousOf(r: ApexResponse): AgentPreviousApex {
  const outcome =
    r.result === 'success' ? 'Ran successfully.' : r.result === 'compileError' ? `Compile error: ${r.compileProblem ?? ''}` : `Exception: ${r.exceptionMessage ?? ''}`
  return { outcome: cutRunText(outcome), debug: cutRunText(userDebugOnly(r.logs)) }
}

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export function ApexAiProvider({ username, children }: { username: string; children: ReactNode }) {
  const apex = useApex()
  const session = useAiSession<ApexProposalOutput, AgentStep>(username)
  // Unsent once the user says so, until the workspace goes (as the SOQL editor's pill).
  const [sendCode, setSendCode] = useState(true)
  const [sendPrevious, setSendPrevious] = useState(false)
  const [attention, setAttention] = useState(0)
  const takeResult = useCallback((on: boolean) => {
    setSendPrevious(on)
    if (on) setAttention((n) => n + 1)
  }, [])
  const last = apex.result.state === 'response' ? apex.result.response : undefined
  const hasCode = !apex.empty
  const { availability, request, start, proposal, applied } = session
  const { getCode, setCode } = apex

  const generate = useCallback(() => {
    const text = request.trim()
    if (!text || availability !== 'ready') return
    // The values when it was pressed: the body reads only these.
    const code = sendCode && hasCode ? getCode() : undefined
    const previous = sendPrevious && last ? previousOf(last) : undefined
    const input = { request: text, language: uiLanguage, timeZone: timeZone(), ...(code !== undefined ? { code } : {}), ...(previous ? { previous } : {}) }
    start(async (signal, progress) => {
      progress('think')
      return (await api.aiAgent(username, { task: 'generateApex', input }, signal)).output
    }, getCode)
  }, [request, availability, sendCode, hasCode, sendPrevious, last, getCode, username, start])

  const fix = useCallback(
    (failed: { code: string; problem: string; line?: number; column?: number }) => {
      if (availability !== 'ready') return
      const input = { ...failed, language: uiLanguage, timeZone: timeZone() }
      start(async (signal, progress) => {
        progress('think')
        return (await api.aiAgent(username, { task: 'fixApex', input }, signal)).output
      }, getCode)
    },
    [availability, username, start, getCode],
  )

  const apply = useCallback(() => {
    if (!proposal) return
    setCode(proposal.code)
    applied()
  }, [proposal, setCode, applied])

  const value = useMemo<ApexAiValue>(
    () => ({ ...session, hasCode, sendCode, setSendCode, hasPrevious: last !== undefined, sendPrevious, setSendPrevious, takeResult, attention, generate, fix, apply }),
    [session, hasCode, sendCode, last, sendPrevious, takeResult, attention, generate, fix, apply],
  )
  return <ApexAiContext.Provider value={value}>{children}</ApexAiContext.Provider>
}

// The hook lives next to its provider; this file is not hot-reloaded as a component.
// oxlint-disable-next-line react/only-export-components
export function useApexAi(): ApexAiValue {
  const value = useContext(ApexAiContext)
  if (!value) throw new Error('useApexAi must be used inside ApexAiProvider')
  return value
}
