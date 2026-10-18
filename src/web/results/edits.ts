// The result table's edits (docs/edit.md "画面"): the changed cells, the
// selected rows and the errors of rows that failed, kept by record Id so that
// they survive later pages and rows going away. Whether a change is kept, and
// what a save or delete leaves, is decided here only.
import { MAX_RECORDS_PER_CALL, type FieldValue, type RecordResult } from '../../shared/api.ts'
import { t } from '../i18n/i18n.ts'

/** A row's changed values, by column key. */
export type RowChanges = Readonly<Record<string, FieldValue>>

export type EditState = {
  editing: boolean
  changes: ReadonlyMap<string, RowChanges>
  selected: ReadonlySet<string>
  /** Salesforce's message for a row whose save or delete failed. */
  errors: ReadonlyMap<string, string>
}

export const initialEdits: EditState = { editing: false, changes: new Map(), selected: new Set(), errors: new Map() }

export type EditAction =
  | { type: 'start' }
  /** Leaves editing; what was changed or selected goes. */
  | { type: 'stop' }
  /** A cell's new value; `same` when it is the value the row has, which drops the change. */
  | { type: 'set'; id: string; column: string; value: FieldValue; same: boolean }
  | { type: 'select'; ids: readonly string[]; on: boolean }
  | { type: 'discard' }
  /** A save's results: the saved rows lose their changes, the failed ones get their message. */
  | { type: 'saved'; results: readonly RecordResult[] }
  /** A delete's results. */
  | { type: 'deleted'; results: readonly RecordResult[] }

/** Salesforce's messages for a failed row, as one line each; a row undone by another's failure says so. */
export function errorText(result: RecordResult): string {
  return result.errors
    .map((e) => (e.statusCode === 'ALL_OR_NONE_OPERATION_ROLLED_BACK' ? t.rolledBack : e.fields.length ? `${e.message} (${e.fields.join(', ')})` : e.message))
    .join('\n')
}

function withResults(errors: ReadonlyMap<string, string>, results: readonly RecordResult[]): Map<string, string> {
  const next = new Map(errors)
  for (const r of results) {
    if (r.success) next.delete(r.id)
    else next.set(r.id, errorText(r))
  }
  return next
}

export function editReducer(state: EditState, action: EditAction): EditState {
  switch (action.type) {
    case 'start':
      return { ...state, editing: true }
    case 'stop':
      return initialEdits
    case 'set': {
      const changes = new Map(state.changes)
      const { [action.column]: _, ...rest } = changes.get(action.id) ?? {}
      const row = action.same ? rest : { ...rest, [action.column]: action.value }
      if (Object.keys(row).length === 0) changes.delete(action.id)
      else changes.set(action.id, row)
      return { ...state, changes }
    }
    case 'select': {
      const selected = new Set(state.selected)
      for (const id of action.ids) {
        if (action.on) selected.add(id)
        else selected.delete(id)
      }
      return { ...state, selected }
    }
    case 'discard':
      return { ...state, changes: new Map(), errors: new Map() }
    case 'saved': {
      const changes = new Map(state.changes)
      for (const r of action.results) if (r.success) changes.delete(r.id)
      return { ...state, changes, errors: withResults(state.errors, action.results) }
    }
    case 'deleted': {
      const changes = new Map(state.changes)
      const selected = new Set(state.selected)
      for (const r of action.results) {
        if (!r.success) continue
        changes.delete(r.id)
        selected.delete(r.id)
      }
      return { ...state, changes, selected, errors: withResults(state.errors, action.results) }
    }
  }
}

/** Under the server's limit of a request body (5 MB), with room for the rest of the body. */
export const MAX_CALL_BYTES = 4 * 1024 * 1024

/**
 * Splits into calls of at most 200 (one sObject Collections call each), and
 * of at most MAX_CALL_BYTES when `bytesOf` weighs each item: 200 long text
 * values could be too large for one request.
 */
export function chunks<T>(items: readonly T[], size = MAX_RECORDS_PER_CALL, bytesOf?: (item: T) => number): T[][] {
  const out: T[][] = []
  let current: T[] = []
  let bytes = 0
  for (const item of items) {
    const weight = bytesOf ? bytesOf(item) : 0
    if (current.length > 0 && (current.length >= size || bytes + weight > MAX_CALL_BYTES)) {
      out.push(current)
      current = []
      bytes = 0
    }
    current.push(item)
    bytes += weight
  }
  if (current.length > 0) out.push(current)
  return out
}
