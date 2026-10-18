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

export function RestProvider({ username, seed, children }: { username: string; seed: Seed | undefined; children: ReactNode }) {
  const { handleCommonError } = useApp()
  const { isProduction, handleOrgError, markAuthError, reportApiUsage } = useOrgs()
  // The first draft: the --rest request, else the one saved for this org.
  const [first] = useState(() =>
    claimRestDraft(username, seed?.rest && { method: seed.rest.method, path: seed.rest.path, headers: [], body: seed.rest.body ?? '' }, emptyDraft),
  )
  const [fields, setFields] = useState<Omit<RestDraft, 'body'>>({ method: first.method, path: first.path, headers: first.headers })
  const body = useRef<EditorHandle | null>(null)
  const bodyText = useRef(first.body)
  const [state, dispatch] = useReducer(reducer, Boolean(seed?.rest), initialState)
  const [history, setHistory] = useState<RestHistoryEntry[]>([])
  // The progress is whether the request being sent may change data.
  const { start: startSend, cancel: cancelSend, running: sending, progress: sendingChangesData } = useTask<boolean>()
  const { start: startHistory, running: historyLoading } = useTask()
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(saveTimer.current), [])

  const save = useCallback((next: Omit<RestDraft, 'body'>) => saveRestDraft(username, { ...next, body: bodyText.current }), [username])
  const update = useCallback(
    (patch: Partial<Omit<RestDraft, 'body'>>) =>
      setFields((current) => {
        const next = { ...current, ...patch }
        save(next)
        return next
      }),
    [save],
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

  // The confirmation and the launch notice go once a request is really being sent.
  useEffect(() => {
    if (sending) dispatch({ type: 'sending' })
  }, [sending])

  const sendNow = useCallback(
    async (request: RestSnapshot) => {
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

  const { result } = state
  const send = useCallback(() => {
    // As the Send button, which cannot be pressed meanwhile: Cmd+Enter while sending does nothing.
    if (sending) return
    const request = snapshotOf({ ...fields, body: body.current?.getText() ?? bodyText.current })
    if (!request.path) return
    const lastUnknown = result.state === 'unknown' ? result.request : undefined
    const reasons = needsConfirm(request, { isProduction, history, lastUnknown })
    if (reasons.length > 0) dispatch({ type: 'confirm', request, reasons })
    else void sendNow(request)
  }, [sending, fields, result, isProduction, history, sendNow])

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
      bodyText.current = draft.body
      body.current?.setText(draft.body)
      const { body: _, ...rest } = draft
      setFields(rest)
      saveRestDraft(username, draft)
    },
    [username],
  )

  const value = useMemo<RestValue>(
    () => ({
      ...state,
      ...fields,
      initialBody: first.body,
      setMethod: (method) => update({ method }),
      setPath: (path) => update({ path }),
      setHeaders: (headers) => update({ headers }),
      registerBody: (handle) => {
        body.current = handle
      },
      onBodyChange: (text) => {
        bodyText.current = text
        // Saved once typing stops: a large body is not written on every key.
        clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => save(fields), 300)
      },
      getBody: () => body.current?.getText() ?? bodyText.current,
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
    [state, fields, first.body, update, save, history, historyLoading, refreshHistory, loadEntry, sending, sendingChangesData, send, confirmSend, cancel, seed?.restLeftOutFor],
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
