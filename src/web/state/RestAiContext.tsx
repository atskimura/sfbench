// The REST API screen's AI (docs/ai-agent.md "画面"): the AI writes a request
// while reading the org's metadata through tools on the server. What every
// screen's AI shares is useAiSession; this holds what is sent and how a
// proposal is put in. Inside the workspace, which is remade for each org.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { AgentRestRequest, RestProposalOutput } from '../../shared/api.ts'
import { api } from '../apiClient.ts'
import { uiLanguage } from '../i18n/i18n.ts'
import type { RestSnapshot } from '../rest/request.ts'
import { useRest } from './RestContext.tsx'
import { useAiSession, type AiSession } from './useAiSession.ts'

/** One step only: how often the AI reads the metadata is not known ahead (docs/ai-agent.md "画面"). */
export type AgentStep = 'think'

/** A proposal, and whether it fixes a request that failed (the card says so). */
export type RestProposal = RestProposalOutput & { fixing: boolean }

type RestAiValue = AiSession<RestProposal, AgentStep> & {
  /** Whether the request fields hold something to send. */
  hasCurrent: boolean
  /** Whether the request now is sent: unticking holds for this workspace. */
  sendCurrent: boolean
  setSendCurrent: (on: boolean) => void
  generate: () => void
  /** Asks the AI to fix a request that Salesforce answered with an error, as it was sent. */
  fix: (sent: RestSnapshot, status: number, responseBody: string) => void
  /** Puts the proposal in the fields: the method, the path and the body (one undoable change). The headers stay. */
  apply: () => void
}

const RestAiContext = createContext<RestAiValue | undefined>(undefined)

/** The most of a response body sent to fix a request: Salesforce's error bodies are far smaller. */
const MAX_ERROR_BODY = 16_000

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

function agentRequest(r: { method: AgentRestRequest['method']; path: string; body?: string }): AgentRestRequest {
  return { method: r.method, path: r.path, body: r.body ?? '' }
}

export function RestAiProvider({ username, children }: { username: string; children: ReactNode }) {
  const rest = useRest()
  const session = useAiSession<RestProposal, AgentStep>(username)
  // Unsent once the user says so, until the workspace goes (as the SOQL editor's pill).
  const [sendCurrent, setSendCurrent] = useState(true)
  const hasCurrent = rest.path.trim() !== ''
  const { availability, request, start, proposal, applied } = session
  const { getBody, setMethod, setPath, setBody } = rest

  const generate = useCallback(() => {
    const text = request.trim()
    if (!text || availability !== 'ready') return
    // The values when it was pressed: the body reads only these.
    const current = sendCurrent && hasCurrent ? agentRequest({ method: rest.method, path: rest.path, body: getBody() }) : undefined
    const input = { request: text, language: uiLanguage, timeZone: timeZone(), ...(current ? { current } : {}) }
    start(async (signal, progress) => {
      progress('think')
      const { output } = await api.aiAgent(username, { task: 'generateRest', input }, signal)
      return { ...output, fixing: false }
    }, getBody)
  }, [request, availability, sendCurrent, hasCurrent, rest.method, rest.path, getBody, username, start])

  const fix = useCallback(
    (sent: RestSnapshot, status: number, responseBody: string) => {
      if (availability !== 'ready') return
      // The start of the body is what tells the error; a whole HTML error page would not fit what the server takes.
      const body = responseBody.length > MAX_ERROR_BODY ? `${responseBody.slice(0, MAX_ERROR_BODY)}\n(cut)` : responseBody
      const input = { sent: agentRequest(sent), status, responseBody: body, language: uiLanguage, timeZone: timeZone() }
      start(async (signal, progress) => {
        progress('think')
        const { output } = await api.aiAgent(username, { task: 'fixRest', input }, signal)
        return { ...output, fixing: true }
      }, getBody)
    },
    [availability, username, start, getBody],
  )

  const apply = useCallback(() => {
    if (!proposal) return
    setMethod(proposal.method)
    setPath(proposal.path)
    setBody(proposal.body)
    applied()
  }, [proposal, setMethod, setPath, setBody, applied])

  const value = useMemo<RestAiValue>(
    () => ({ ...session, hasCurrent, sendCurrent, setSendCurrent, generate, fix, apply }),
    [session, hasCurrent, sendCurrent, generate, fix, apply],
  )
  return <RestAiContext.Provider value={value}>{children}</RestAiContext.Provider>
}

// The hook lives next to its provider; this file is not hot-reloaded as a component.
// oxlint-disable-next-line react/only-export-components
export function useRestAi(): RestAiValue {
  const value = useContext(RestAiContext)
  if (!value) throw new Error('useRestAi must be used inside RestAiProvider')
  return value
}
