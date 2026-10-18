// The REST API screen's state (docs/rest.md "送信の流れ"). Inside the
// workspace, which is remade for each org: switching orgs stops the screen's
// request (the server still finishes it and records it in the history).
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import type { RestHistoryEntry, RestMethod } from '../../shared/api.ts'
import { api } from '../apiClient.ts'
import { isOutcomeUnknown, runFailure } from '../errors.ts'
import { t } from '../i18n/i18n.ts'
import { restMayChangeData } from '../rest/changes.ts'
import { needsConfirm } from '../rest/confirm.ts'
import { claimRestDraft, saveRestDraft } from '../rest/draftStorage.ts'
import { draftOf, emptyDraft, snapshotOf, type HeaderRow, type RestDraft, type RestSnapshot } from '../rest/request.ts'
import { initialState, reducer, type State } from '../rest/restState.ts'
import { useApp } from './AppContext.tsx'
import type { EditorHandle } from './SoqlContext.tsx'
import { useOrgs, type Seed } from './OrgContext.tsx'
import { useTask } from './useTask.ts'

type RestValue = State & {
  /** The request fields; the body is the editor's (`initialBody` is its first text). */
  method: RestMethod
  path: string
  headers: HeaderRow[]
  initialBody: string
  setMethod: (method: RestMethod) => void
  setPath: (path: string) => void
  setHeaders: (rows: HeaderRow[]) => void
  registerBody: (handle: EditorHandle | null) => void
  onBodyChange: (text: string) => void
  getBody: () => string
  /** Replaces the body as one undoable change (Format). */
  setBody: (text: string) => void
  history: RestHistoryEntry[]
  historyLoading: boolean
  refreshHistory: () => void
  loadEntry: (entry: RestHistoryEntry) => void
  /** A request is being sent: decided by the send task only. */
  sending: boolean
  /** The request being sent may change data: it cannot be cancelled. */
  sendingChangesData: boolean
  /** Sends the fields, asking first when needsConfirm says so. */
  send: () => void
  confirmSend: () => void
  cancelConfirm: () => void
  /** Stops waiting for a request that changes no data. */
  cancel: () => void
  closeNotice: () => void
  /** The --rest request was for this org and was left out. */
  restLeftOutFor: string | undefined
}

const RestContext = createContext<RestValue | undefined>(undefined)

/** A request whose outcome is not known, put in the history at once (docs/rest.md "確認するかどうか"). */
function localUnknown(request: RestSnapshot): RestHistoryEntry {
  return {
    id: `local-${Date.now()}`,
    method: request.method,
    path: request.path,
    headers: request.headers,
    ...(request.body !== undefined ? { body: request.body } : {}),
    sentAt: new Date().toISOString(),
    outcome: { state: 'unknown', reason: 'error' },
  }
}

export function RestProvider({ username, seed, children }: { username: string; seed: Seed | undefined; children: ReactNode }) {
  const { handleCommonError } = useApp()
  const { isProduction, handleOrgError, markAuthError, reportApiUsage } = useOrgs()
  // The first draft: the --rest request, else the one saved for this org.
  const [first] = useState(() =>
    claimRestDraft(username, seed?.rest && { method: seed.rest.method, path: seed.rest.path, headers: [], body: seed.rest.body ?? '' }, emptyDraft),
  )
  // The draft as it is now: the one source the fields render from and the
  // storage saves. The body is the editor's text, followed on each change.
  const latest = useRef<RestDraft>(first)
  const [fields, setFields] = useState<Omit<RestDraft, 'body'>>({ method: first.method, path: first.path, headers: first.headers })
  const body = useRef<EditorHandle | null>(null)
  const [state, dispatch] = useReducer(reducer, Boolean(seed?.rest), initialState)
  const [history, setHistory] = useState<RestHistoryEntry[]>([])
  // The progress is whether the request being sent may change data.
  const { start: startSend, cancel: cancelSend, running: sending, progress: sendingChangesData } = useTask<boolean>()
  const { start: startHistory, running: historyLoading } = useTask()
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  /** Saves the draft as it is now, at once. */
  const persist = useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = undefined
    saveRestDraft(username, latest.current)
  }, [username])
  /** Saves once typing stops: a large body is not written on every key. */
  const persistSoon = useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(persist, 300)
  }, [persist])
  // A save still waiting is done when the page goes or the workspace is remade.
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current !== undefined) persist()
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [persist])

  /** Changes the draft: what renders and what is saved both come from `latest`. */
  const change = useCallback(
    (next: RestDraft, save: 'now' | 'soon') => {
      latest.current = next
      setFields({ method: next.method, path: next.path, headers: next.headers })
      if (save === 'now') persist()
      else persistSoon()
    },
    [persist, persistSoon],
  )

  const refreshHistory = useCallback(async () => {
    const outcome = await startHistory((signal) => api.restHistory(username, signal), 'replace')
    // A failure shows nothing: the list stays as it was (docs/rest.md "画面").
    if (outcome.kind === 'done') setHistory(outcome.value.entries)
  }, [startHistory, username])

  useEffect(() => {
    void refreshHistory()
    // Once per workspace, which is remade for each org.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendNow = useCallback(
    async (request: RestSnapshot) => {
      // Never called while sending (send does nothing then), so this send starts.
      dispatch({ type: 'sending' })
      const changesData = restMayChangeData(request.method, request.path)
      const outcome = await startSend((signal, progress) => {
        progress(changesData)
        return api.rest(username, request, signal)
      }, 'ignore')
      if (outcome.kind === 'stale') return
      // The server has written how it ended.
      void refreshHistory()
      if (outcome.kind === 'done') {
        const { apiUsage, ...response } = outcome.value
        reportApiUsage(username, apiUsage)
        dispatch({ type: 'result', result: { state: 'response', request, response } })
        return
      }
      const e = outcome.error
      if (isOutcomeUnknown(e, changesData)) {
        // A lost session still shows its band; the result says the outcome is unknown.
        handleCommonError(e)
        // Asked about before it is sent again even before the history is loaded
        // again, or if it cannot be: the server's copy replaces this one.
        setHistory((entries) => [localUnknown(request), ...entries])
        dispatch({ type: 'result', result: { state: 'unknown', request, message: t.restUnknown } })
        return
      }
      const failure = runFailure(e)
      if (!failure) {
        handleOrgError(username, e)
        dispatch({ type: 'result', result: { state: 'idle' } })
        return
      }
      if (failure.orgAuth) markAuthError(username, failure.reloginCommand)
      dispatch({ type: 'result', result: { state: 'error', request, message: failure.message, details: failure.details, reloginCommand: failure.reloginCommand } })
    },
    [startSend, username, refreshHistory, reportApiUsage, handleCommonError, handleOrgError, markAuthError],
  )

  const send = useCallback(() => {
    // As the Send button, which cannot be pressed meanwhile: Cmd+Enter while sending does nothing.
    if (sending) return
    const request = snapshotOf(latest.current)
    if (!request.path) return
    const reasons = needsConfirm(request, { isProduction, history })
    if (reasons.length > 0) dispatch({ type: 'confirm', request, reasons })
    else void sendNow(request)
  }, [sending, isProduction, history, sendNow])

  const { confirming } = state
  const confirmSend = useCallback(() => {
    // The request as it was when Send was pressed, not the fields now.
    if (confirming) void sendNow(confirming.request)
  }, [confirming, sendNow])

  const cancel = useCallback(() => {
    // Only a request that changes no data offers Cancel; a stopped one empties the result.
    if (cancelSend()) dispatch({ type: 'cancelled' })
  }, [cancelSend])

  const loadEntry = useCallback(
    (entry: RestHistoryEntry) => {
      const draft = draftOf(entry)
      change(draft, 'now')
      // Its change comes back through onBodyChange with the same text.
      body.current?.setText(draft.body)
    },
    [change],
  )

  const value = useMemo<RestValue>(
    () => ({
      ...state,
      ...fields,
      initialBody: first.body,
      setMethod: (method) => change({ ...latest.current, method }, 'soon'),
      setPath: (path) => change({ ...latest.current, path }, 'soon'),
      setHeaders: (headers) => change({ ...latest.current, headers }, 'soon'),
      registerBody: (handle) => {
        body.current = handle
      },
      onBodyChange: (text) => {
        if (text === latest.current.body) return
        latest.current = { ...latest.current, body: text }
        persistSoon()
      },
      getBody: () => latest.current.body,
      setBody: (text) => body.current?.setText(text),
      history,
      historyLoading,
      refreshHistory: () => void refreshHistory(),
      loadEntry,
      sending,
      sendingChangesData: sending && sendingChangesData === true,
      send,
      confirmSend,
      cancelConfirm: () => dispatch({ type: 'confirmCancelled' }),
      cancel,
      closeNotice: () => dispatch({ type: 'noticeClosed' }),
      restLeftOutFor: seed?.restLeftOutFor,
    }),
    [state, fields, first.body, change, persistSoon, history, historyLoading, refreshHistory, loadEntry, sending, sendingChangesData, send, confirmSend, cancel, seed?.restLeftOutFor],
  )
  return <RestContext.Provider value={value}>{children}</RestContext.Provider>
}

// The hook lives next to its provider; this file is not hot-reloaded as a component.
// oxlint-disable-next-line react/only-export-components
export function useRest(): RestValue {
  const value = useContext(RestContext)
  if (!value) throw new Error('useRest must be used inside RestProvider')
  return value
}
