// docs/edit.md "画面": what can be edited, how text becomes a value, and what a save or delete leaves.
import { describe, expect, it } from 'vitest'
import type { FieldDescribe } from '../apiClient.ts'
import { addColumns } from './columns.ts'
import { editableColumns, editTarget, fieldValue, inputKind, isEditableValue, isSameValue } from './editable.ts'
import { chunks, editReducer, initialEdits } from './edits.ts'

const account = (fields: Record<string, unknown>) => ({ attributes: { type: 'Account', url: '' }, ...fields })
const field = (name: string, type: string, updateable = true): FieldDescribe => ({ name, label: name, type, relationshipName: null, referenceTo: [], updateable })

describe('editTarget', () => {
  const records = [account({ Id: '001', Name: 'A' })]
  it('edits the rows of an object queried with its Id', () => {
    expect(editTarget({ tooling: false, records }, addColumns([], records))).toEqual({ object: 'Account' })
  })
  it('does not edit Tooling API, aggregate, Id-less or empty results', () => {
    expect(editTarget({ tooling: true, records }, addColumns([], records))).toEqual({ reason: 'tooling' })
    const aggregate = [{ attributes: { type: 'AggregateResult' }, expr0: 3 }]
    expect(editTarget({ tooling: false, records: aggregate }, addColumns([], aggregate))).toEqual({ reason: 'aggregate' })
    const noId = [account({ Name: 'A' })]
    expect(editTarget({ tooling: false, records: noId }, addColumns([], noId))).toEqual({ reason: 'noId' })
    expect(editTarget({ tooling: false, records: [] }, [])).toEqual({ reason: 'empty' })
  })
})

describe('editableColumns', () => {
  const records = [account({ Id: '001', Name: 'A', Formula__c: 1, Owner: { attributes: { type: 'User' }, Name: 'U' }, Score__c: 2 })]
  const fields = [field('Id', 'id', false), field('Name', 'string'), field('Formula__c', 'double', false), field('ns__Score__c', 'double')]
  it("takes the object's own updateable fields, matching one written without the namespace", () => {
    const editable = editableColumns(addColumns([], records), fields, 'ns')
    expect([...editable.keys()]).toEqual(['Name', 'Score__c'])
    expect(editable.get('Score__c')?.name).toBe('ns__Score__c')
  })
})

describe('values', () => {
  it('picks the input by type', () => {
    expect(['boolean', 'picklist', 'textarea', 'double', 'date'].map((type) => inputKind({ type }))).toEqual(['checkbox', 'picklist', 'textarea', 'text', 'text'])
  })
  it('does not edit a number already rounded when the browser read it', () => {
    expect(isEditableValue(1234.5)).toBe(true)
    expect(isEditableValue(123456789012345)).toBe(true)
    // As the browser reads it from a result.
    expect(isEditableValue(JSON.parse('12345678901234567'))).toBe(false)
    expect(isEditableValue(0.1234567890123456)).toBe(false)
    expect(isEditableValue(1e21)).toBe(false)
    expect(isEditableValue('12345678901234567.25')).toBe(true)
  })

  it('sends text as it is, numbers too, and empty as null', () => {
    expect(fieldValue('12345678901234567.25')).toBe('12345678901234567.25')
    expect(fieldValue('')).toBeNull()
  })
  it('takes the value the row has for no change', () => {
    expect(isSameValue(1000, '1000')).toBe(true)
    expect(isSameValue(1000, '1000.0')).toBe(false)
    expect(isSameValue(null, null)).toBe(true)
    expect(isSameValue(undefined, null)).toBe(true)
    expect(isSameValue(true, true)).toBe(true)
    expect(isSameValue('A', null)).toBe(false)
  })
})

describe('editReducer', () => {
  const editing = editReducer(initialEdits, { type: 'start' })
  const changed = editReducer(editReducer(editing, { type: 'set', id: 'a', column: 'Name', value: 'A2', same: false }), { type: 'set', id: 'b', column: 'Name', value: null, same: false })

  it('keeps changes by row, and drops a cell set back to its value', () => {
    expect(changed.changes.get('a')).toEqual({ Name: 'A2' })
    const back = editReducer(changed, { type: 'set', id: 'a', column: 'Name', value: 'A', same: true })
    expect(back.changes.has('a')).toBe(false)
  })

  it('keeps the changes of failed rows with their messages after a save', () => {
    const saved = editReducer(changed, {
      type: 'saved',
      results: [
        { id: 'a', success: true, errors: [] },
        { id: 'b', success: false, errors: [{ statusCode: 'REQUIRED_FIELD_MISSING', message: 'Required fields are missing', fields: ['Name'] }] },
      ],
    })
    expect([...saved.changes.keys()]).toEqual(['b'])
    expect(saved.errors.get('b')).toBe('Required fields are missing (Name)')
  })

  it('drops deleted rows from the selection and keeps the failed ones', () => {
    const selected = editReducer(changed, { type: 'select', ids: ['a', 'b'], on: true })
    const deleted = editReducer(selected, {
      type: 'deleted',
      results: [
        { id: 'a', success: true, errors: [] },
        { id: 'b', success: false, errors: [{ statusCode: 'DELETE_FAILED', message: 'In use', fields: [] }] },
      ],
    })
    expect([...deleted.selected]).toEqual(['b'])
    expect(deleted.changes.has('a')).toBe(false)
    expect(deleted.errors.get('b')).toBe('In use')
  })

  it('forgets everything when editing stops', () => {
    expect(editReducer(changed, { type: 'stop' })).toEqual(initialEdits)
  })
})

describe('chunks', () => {
  it('splits into calls of at most 200', () => {
    expect(chunks(Array.from({ length: 401 }, (_, i) => i)).map((c) => c.length)).toEqual([200, 200, 1])
  })

  it('splits by size too, keeping one item per call even when it alone is large', () => {
    const mb = 1024 * 1024
    expect(chunks([3, 3, 5, 1].map((n) => n * mb), 200, (n) => n).map((c) => c.length)).toEqual([1, 1, 1, 1])
    expect(chunks([1, 1, 1, 1, 1].map((n) => n * mb), 200, (n) => n).map((c) => c.length)).toEqual([4, 1])
  })
})
