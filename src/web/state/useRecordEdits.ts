// Editing the rows of one query result (docs/edit.md "画面"): the changes and
// the selection (results/edits.ts), the fields that can be edited, and the
// save and delete, sent 200 rows at a time. One per result table, which is
// remade for each result: a save running when it goes is dropped (stale).
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import type { ApiUsage, FieldValue, RecordResult } from '../../shared/api.ts'
import { api, type FieldDescribe } from '../apiClient.ts'
import { runFailed } from '../execution.ts'
import { t } from '../i18n/i18n.ts'
import type { Column, SObjectRecord } from '../results/columns.ts'
import { editableColumns, editTarget, type EditTarget } from '../results/editable.ts'
import { chunks, editReducer, initialEdits, type EditState, type RowChanges } from '../results/edits.ts'
import { useApp } from './AppContext.tsx'
import { describeSObject, useLoadable } from './describeCache.ts'
import { useOrgs } from './OrgContext.tsx'
import { useTask } from './useTask.ts'

const ALL_OR_NONE_KEY = 'sfbench.allOrNone'
const encoder = new TextEncoder()

function readAllOrNone(): boolean {
  try {
    return localStorage.getItem(ALL_OR_NONE_KEY) === 'true'
  } catch {
    return false
  }
}

type Sent = {
  results: RecordResult[]
  apiUsage: ApiUsage | undefined
  /** The call that failed, if one did: it and the calls after it. */
  failure?: { error: unknown }
}

export type EditMessage =
  | { kind: 'done'; text: string }
  | { kind: 'unknown'; text: string }
  | { kind: 'error'; text: string; details?: unknown; reloginCommand?: string }

export type Confirming = { kind: 'save' | 'delete'; lines: string[] }

type Options = {
  username: string
  result: { tooling: boolean; apiVersion: string | undefined; records: readonly SObjectRecord[] }
  records: readonly SObjectRecord[]
  columns: readonly Column[]
  /** The ids of the rows shown (the filter's), for "select all" and for dropping hidden selections. */
  shownIds: readonly string[]
  patchRows: (values: ReadonlyMap<string, RowChanges>) => void
  removeRows: (ids: ReadonlySet<string>) => void
  /** The namespace, to match columns written without it. */
  ns: string | null | undefined
}

export function useRecordEdits({ username, result, records, columns, shownIds, patchRows, removeRows, ns }: Options) {
  const { setUnsavedEdits, handleCommonError } = useApp()
  const { isProduction, selectedOrg, handleOrgError, markAuthError, reportApiUsage } = useOrgs()
  const [state, dispatch] = useReducer(editReducer, initialEdits)
  const [allOrNone, setAllOrNoneState] = useState(readAllOrNone)
  const [confirming, setConfirming] = useState<Confirming>()
  const [message, setMessage] = useState<EditMessage>()
  const { start, running: sending, progress } = useTask<{ kind: 'save' | 'delete'; done: number; total: number }>()

  const target: EditTarget = useMemo(() => editTarget(result, columns), [result, columns])
  const object = 'object' in target ? target.object : undefined
  // Read only once editing starts, on the version the query ran on.
  const describe = useLoadable(state.editing && object ? `${username}\n${object}\n${result.apiVersion}` : undefined, () =>
    describeSObject(username, object!, false, result.apiVersion),
  )
  const fields: ReadonlyMap<string, FieldDescribe> | undefined = useMemo(
    () => (describe.data ? editableColumns(columns, describe.data.fields, ns) : undefined),
    [describe.data, columns, ns],
  )

  // Changes not saved are asked about before they go (docs/edit.md); a save being sent blocks that.
  useEffect(() => setUnsavedEdits(state.changes.size, sending), [state.changes.size, sending, setUnsavedEdits])
  useEffect(() => () => setUnsavedEdits(0), [setUnsavedEdits])

  // A selected row the filter hides is not deleted unseen: it is no longer selected.
  useEffect(() => {
    if (state.selected.size === 0) return
    const shown = new Set(shownIds)
    const hidden = [...state.selected].filter((id) => !shown.has(id))
    if (hidden.length > 0) dispatch({ type: 'select', ids: hidden, on: false })
  }, [shownIds, state.selected])

  const recordById = useMemo(() => new Map(records.map((r) => [r.Id as string, r])), [records])

  const setAllOrNone = useCallback((on: boolean) => {
    setAllOrNoneState(on)
    try {
      localStorage.setItem(ALL_OR_NONE_KEY, String(on))
    } catch {
      // Only remembering the choice is lost.
    }
  }, [])

  /** The values a save sends for a row, by field name (the column key may lack the namespace). */
  const payload = useCallback(
    (id: string) => Object.fromEntries(Object.entries(state.changes.get(id) ?? {}).map(([key, value]) => [fields?.get(key)?.name ?? key, value])),
    [state.changes, fields],
  )

  /** The save split into calls: 200 rows, and the body's size in bytes (UTF-8, as it is sent). */
  const saveCalls = useCallback(
    (ids: readonly string[]) => chunks(ids, undefined, (id) => encoder.encode(JSON.stringify(payload(id))).length),
    [payload],
  )

  /** Sends the calls one after another; stops at the first that fails, keeping what came before. */
  const send = useCallback(
    async (kind: 'save' | 'delete', ids: string[]) => {
      setMessage(undefined)
      const version = result.apiVersion ? { apiVersion: result.apiVersion } : {}
      // Each call's values are fixed now: the table cannot change while they are sent.
      const calls =
        kind === 'save'
          ? saveCalls(ids).map((call) => {
              const records = call.map((id) => ({ id, fields: payload(id) as Record<string, FieldValue> }))
              return (signal: AbortSignal) => api.recordsUpdate(username, { object: object!, records, allOrNone, ...version }, signal)
            })
          : chunks(ids).map((call) => (signal: AbortSignal) => api.recordsDelete(username, { ids: call, allOrNone, ...version }, signal))
      const outcome = await start(async (signal, report): Promise<Sent> => {
        const sent: Sent = { results: [], apiUsage: undefined }
        for (const call of calls) {
          report({ kind, done: sent.results.length, total: ids.length })
          try {
            const answer = await call(signal)
            sent.results.push(...answer.results)
            sent.apiUsage = answer.apiUsage ?? sent.apiUsage
          } catch (error) {
            return { ...sent, failure: { error } }
          }
        }
        return sent
      }, 'ignore')
      if (outcome.kind !== 'done') return
      const { results, apiUsage, failure } = outcome.value
      reportApiUsage(username, apiUsage)
      const succeeded = results.filter((r) => r.success)
      if (kind === 'save') {
        patchRows(new Map(succeeded.map((r) => [r.id, state.changes.get(r.id) ?? {}])))
        dispatch({ type: 'saved', results })
      } else {
        removeRows(new Set(succeeded.map((r) => r.id)))
        dispatch({ type: 'deleted', results })
      }
      const failed = results.length - succeeded.length
      const summary = kind === 'save' ? t.savedRows(succeeded.length, failed) : t.deletedRows(succeeded.length, failed)
      if (!failure) {
        setMessage({ kind: 'done', text: summary })
        return
      }
      const done = results.length > 0 ? `${summary}\n` : ''
      const failedCall = runFailed(failure.error, true)
      if (failedCall.kind === 'unknown') {
        handleCommonError(failure.error)
        setMessage({ kind: 'unknown', text: done + t.editsUnknown })
        return
      }
      if (failedCall.kind === 'elsewhere') {
        handleOrgError(username, failure.error)
        setMessage({ kind: 'error', text: done + t.editsStopped })
        return
      }
      if (failedCall.orgAuth) markAuthError(username, failedCall.reloginCommand)
      setMessage({ kind: 'error', text: `${done}${failedCall.message}\n${t.editsStopped}`, details: failedCall.details, reloginCommand: failedCall.reloginCommand })
    },
    [start, payload, saveCalls, object, allOrNone, username, result.apiVersion, reportApiUsage, patchRows, removeRows, state.changes, handleCommonError, handleOrgError, markAuthError],
  )

  const orgName = selectedOrg?.alias ?? username
  const save = useCallback(() => {
    if (sending || state.changes.size === 0 || !fields) return
    const count = state.changes.size
    if (isProduction) setConfirming({ kind: 'save', lines: [t.confirmSaveProduction(orgName, object ?? '', count)] })
    else void send('save', [...state.changes.keys()])
  }, [sending, state.changes, fields, isProduction, orgName, object, send])

  const remove = useCallback(() => {
    if (sending || state.selected.size === 0) return
    // A delete is always asked about (利用者と決めたこと 3).
    const lines = [t.confirmDelete(object ?? '', state.selected.size), ...(isProduction ? [t.confirmDeleteProduction(orgName)] : [])]
    setConfirming({ kind: 'delete', lines })
  }, [sending, state.selected, object, isProduction, orgName])

  const confirm = useCallback(() => {
    if (!confirming) return
    setConfirming(undefined)
    void send(confirming.kind, confirming.kind === 'save' ? [...state.changes.keys()] : [...state.selected])
  }, [confirming, send, state.changes, state.selected])

  /** More than one call, and "undo all if one fails" covers one call only (docs/edit.md 前提の6). */
  const saveTooManyForAllOrNone = useMemo(() => allOrNone && saveCalls([...state.changes.keys()]).length > 1, [allOrNone, saveCalls, state.changes])
  const deleteTooManyForAllOrNone = allOrNone && state.selected.size > 200

  return {
    target,
    editing: state.editing,
    state: state as EditState,
    dispatch,
    fields,
    fieldsError: describe.error,
    recordById,
    allOrNone,
    setAllOrNone,
    saveTooManyForAllOrNone,
    deleteTooManyForAllOrNone,
    save,
    remove,
    confirming,
    confirm,
    cancelConfirm: () => setConfirming(undefined),
    message,
    closeMessage: () => setMessage(undefined),
    sending,
    progress: sending ? progress : undefined,
  }
}
