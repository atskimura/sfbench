// docs/edit.md "サーバー": what a save or delete from the result table may send, and how the answer comes back.
import { describe, expect, it } from 'vitest'
import { checkDelete, checkUpdate, recordResults, RecordsRequestError, updateBody } from './records.ts'

const id = '0012w000005TOPyAAO'

describe('checkUpdate', () => {
  it('takes text, true, false and null as values', () => {
    const request = checkUpdate({ object: 'Account', records: [{ id, fields: { Name: 'A', IsActive__c: false, Description: null, NumberOfEmployees: '12' } }], allOrNone: true })
    expect(request).toEqual({ object: 'Account', records: [{ id, fields: { Name: 'A', IsActive__c: false, Description: null, NumberOfEmployees: '12' } }], allOrNone: true })
  })

  it('refuses what is not a plain save of named fields', () => {
    const bad: Record<string, unknown>[] = [
      { object: 'Account; DROP', records: [{ id, fields: { Name: 'A' } }] },
      { object: 'Account', records: [] },
      { object: 'Account', records: Array.from({ length: 201 }, () => ({ id, fields: { Name: 'A' } })) },
      { object: 'Account', records: [{ id: '001', fields: { Name: 'A' } }] },
      { object: 'Account', records: [{ id, fields: {} }] },
      { object: 'Account', records: [{ id, fields: { Id: 'x' } }] },
      { object: 'Account', records: [{ id, fields: { attributes: 'x' } }] },
      { object: 'Account', records: [{ id, fields: { 'Name.x': 'A' } }] },
      { object: 'Account', records: [{ id, fields: { NumberOfEmployees: 12 } }] },
      { object: 'Account', records: [{ id, fields: { Name: { a: 1 } } }] },
    ]
    for (const input of bad) expect(() => checkUpdate(input)).toThrow(RecordsRequestError)
  })

  it('takes allOrNone only when it is true', () => {
    expect(checkUpdate({ object: 'Account', records: [{ id, fields: { Name: 'A' } }], allOrNone: 'yes' }).allOrNone).toBe(false)
  })
})

describe('checkDelete', () => {
  it('takes up to 200 ids of 15 or 18 characters', () => {
    expect(checkDelete({ ids: [id, id.slice(0, 15)], allOrNone: false })).toEqual({ ids: [id, id.slice(0, 15)], allOrNone: false })
    expect(() => checkDelete({ ids: [] })).toThrow(RecordsRequestError)
    expect(() => checkDelete({ ids: Array.from({ length: 201 }, () => id) })).toThrow(RecordsRequestError)
    expect(() => checkDelete({ ids: [`${id},001`] })).toThrow(RecordsRequestError)
  })
})

describe('updateBody', () => {
  it('writes each record with its type, its fields and its id', () => {
    expect(JSON.parse(updateBody({ object: 'Account', records: [{ id, fields: { Name: 'A', AnnualRevenue: '12345678901234567.25' } }], allOrNone: false }))).toEqual({
      allOrNone: false,
      records: [{ attributes: { type: 'Account' }, Name: 'A', AnnualRevenue: '12345678901234567.25', id }],
    })
  })
})

describe('recordResults', () => {
  it('pairs each answer with the id sent, as a failed one comes without its id', () => {
    const answer = [
      { id, success: true, errors: [] },
      { success: false, errors: [{ statusCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'Name is required', fields: ['Name'] }] },
    ]
    expect(recordResults([id, '0012w000005TOPzAAO'], answer)).toEqual([
      { id, success: true, errors: [] },
      { id: '0012w000005TOPzAAO', success: false, errors: [{ statusCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'Name is required', fields: ['Name'] }] },
    ])
  })

  it('does not guess at an answer of another shape: what Salesforce did is not known', () => {
    expect(() => recordResults([id], { ok: true })).toThrow()
    expect(() => recordResults([id, id], [{ success: true }])).toThrow()
  })
})
