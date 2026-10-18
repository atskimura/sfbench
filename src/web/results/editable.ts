// Whether a result can be edited, which of its columns, and how typed text
// becomes the value sent (docs/edit.md "画面"). Pure, so that it is tested
// without the table.
import type { FieldValue } from '../../shared/api.ts'
import type { FieldDescribe } from '../apiClient.ts'
import type { Column, SObjectRecord } from './columns.ts'

/** Why a result cannot be edited, or the object its rows are. */
export type EditTarget = { object: string } | { reason: 'tooling' | 'aggregate' | 'noId' | 'empty' }

export function editTarget(result: { tooling: boolean; records: readonly SObjectRecord[] }, columns: readonly Column[]): EditTarget {
  if (result.tooling) return { reason: 'tooling' }
  const type = (result.records[0]?.attributes as { type?: unknown } | undefined)?.type
  if (typeof type !== 'string') return { reason: 'empty' }
  if (type === 'AggregateResult') return { reason: 'aggregate' }
  if (!columns.some((c) => c.path.length === 1 && c.key === 'Id')) return { reason: 'noId' }
  return { object: type }
}

/**
 * The columns that can be edited, each with its field: the FROM object's own
 * fields (one level) that the describe says are updateable. A column written
 * without the namespace (the namespace header was sent) matches the field
 * with it; the field's own name is what is sent.
 */
export function editableColumns(columns: readonly Column[], fields: readonly FieldDescribe[], ns: string | null | undefined): Map<string, FieldDescribe> {
  const byName = new Map(fields.map((f) => [f.name.toLowerCase(), f]))
  const editable = new Map<string, FieldDescribe>()
  for (const column of columns) {
    if (column.kind !== 'value' || column.path.length !== 1 || column.key === 'Id') continue
    const key = column.key.toLowerCase()
    const field = byName.get(key) ?? (ns ? byName.get(`${ns.toLowerCase()}__${key}`) : undefined)
    if (field?.updateable) editable.set(column.key, field)
  }
  return editable
}

export type InputKind = 'checkbox' | 'picklist' | 'textarea' | 'text'

export function inputKind(field: Pick<FieldDescribe, 'type'>): InputKind {
  if (field.type === 'boolean') return 'checkbox'
  if (field.type === 'picklist') return 'picklist'
  if (field.type === 'textarea') return 'textarea'
  return 'text'
}

/**
 * Whether a cell holds a value that can be edited without changing what was
 * not asked: a number with more than 15 significant digits was already rounded
 * when the browser read the result, so saving it would write the rounded value.
 */
export function isEditableValue(value: unknown): boolean {
  if (typeof value !== 'number') return true
  const text = String(Math.abs(value))
  if (/e/i.test(text)) return false
  return text.replace('.', '').replace(/^0+/, '').length <= 15
}

/** The text an input starts with: the value as Salesforce returned it. */
export function inputText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

/**
 * The value sent for typed text: empty is null; anything else goes as text,
 * numbers included, so that no digit is rounded (Salesforce reads them).
 */
export function fieldValue(text: string): FieldValue {
  return text === '' ? null : text
}

/** Whether `next` would leave the value as it was, so that it is no change. */
export function isSameValue(original: unknown, next: FieldValue): boolean {
  if (next === null) return original === null || original === undefined || original === ''
  if (typeof next === 'boolean') return original === next
  return inputText(original) === next
}
