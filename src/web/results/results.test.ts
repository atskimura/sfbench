import { describe, expect, it } from 'vitest'
import { addColumns, cellText, cellValue, columnWidth, isNumberColumn, type SObjectRecord } from './columns.ts'
import { csvFileName, toCsv } from './csv.ts'
import { isRecordId } from './recordId.ts'

const attrs = { attributes: { type: 'Contact', url: '/x' } }
const keys = (records: SObjectRecord[], before = addColumns([], [])) => addColumns(before, records).map((c) => c.key)

describe('addColumns', () => {
  it('collects keys in order, flattens parent relationships and skips attributes', () => {
    const records = [{ ...attrs, Id: '1', Account: { ...attrs, Name: 'A', Owner: { ...attrs, Name: 'O' } }, expr0: 3 }]
    expect(keys(records)).toEqual(['Id', 'Account.Name', 'Account.Owner.Name', 'expr0'])
  })

  it('makes one column for a child relationship', () => {
    const records = [{ Id: '1', Contacts: { totalSize: 2, done: true, records: [{ Id: 'c' }] } }]
    expect(addColumns([], records).map((c) => [c.key, c.kind])).toEqual([
      ['Id', 'value'],
      ['Contacts', 'child'],
    ])
  })

  it('replaces a parent relationship that was null on the earlier pages with its fields', () => {
    const first = addColumns([], [{ Id: '1', Account: null, Name: 'x' }])
    expect(first.map((c) => c.key)).toEqual(['Id', 'Account', 'Name'])
    const next = addColumns(first, [{ Id: '2', Account: { Name: 'A', Industry: 'I' }, Name: 'y' }])
    expect(next.map((c) => c.key)).toEqual(['Id', 'Account.Name', 'Account.Industry', 'Name'])
  })

  it('does not add a null parent relationship when its fields are already columns', () => {
    expect(keys([{ Id: '1', Account: { Name: 'A' } }, { Id: '2', Account: null }])).toEqual(['Id', 'Account.Name'])
  })

  it('puts a new column of a parent relationship after the others of that relationship', () => {
    const first = addColumns([], [{ Id: '1', Account: { Name: 'A', Owner: null }, Name: 'x' }])
    const next = addColumns(first, [{ Id: '2', Account: { Name: 'B', Owner: { Name: 'O', Email: 'e' } }, Name: 'y' }])
    expect(next.map((c) => c.key)).toEqual(['Id', 'Account.Name', 'Account.Owner.Name', 'Account.Owner.Email', 'Name'])
  })
})

describe('cells', () => {
  it('reads values along the path, and null through a null parent', () => {
    const [, name] = addColumns([], [{ Id: '1', Account: { Name: 'A' } }])
    expect(cellValue({ Id: '1', Account: { Name: 'A' } }, name)).toBe('A')
    expect(cellValue({ Id: '2', Account: null }, name)).toBeNull()
  })

  it('shows child relationships as row counts and other objects as JSON', () => {
    expect(cellText({ totalSize: 3, done: true, records: [] })).toBe('3 rows')
    expect(cellText({ city: 'Tokyo' })).toBe('{"city":"Tokyo"}')
    expect(cellText(null)).toBe('')
    expect(cellText(false)).toBe('false')
  })

  it('sizes columns by the header and values, counting wide characters twice, within limits', () => {
    const records = [{ Name: '取引先' }, { Name: 'x'.repeat(100) }]
    const [name] = addColumns([], records)
    expect(columnWidth(name, records.slice(0, 1))).toBe(6)
    expect(columnWidth(name, records)).toBe(48)
  })

  it('right-aligns columns whose values are numbers', () => {
    const records = [{ Amount: 10, Name: 'a' }, { Amount: null, Name: '1' }]
    const [amount, name] = addColumns([], records)
    expect(isNumberColumn(amount, records)).toBe(true)
    expect(isNumberColumn(name, records)).toBe(false)
  })
})

describe('isRecordId', () => {
  it('accepts 18-character IDs with a matching suffix only', () => {
    expect(isRecordId('001J5000001lD1EIAU')).toBe(true)
    expect(isRecordId('001J5000001lD1EIAA')).toBe(false)
    expect(isRecordId('001J5000001lD1E')).toBe(false)
    expect(isRecordId('ABCDEFGHIJKLMNOPQR')).toBe(false)
    expect(isRecordId(18)).toBe(false)
  })
})

describe('toCsv', () => {
  it('writes a BOM, quotes commas, newlines and double quotes, and counts child rows', () => {
    const records = [{ Name: 'a,b', Note: 'say "hi"\nbye', Contacts: { totalSize: 2, records: [] } }, { Name: 'plain', Note: null, Contacts: null }]
    const columns = addColumns([], records)
    expect(toCsv(columns, records)).toBe('﻿Name,Note,Contacts\r\n"a,b","say ""hi""\nbye",2 rows\r\nplain,,\r\n')
  })

  it('names the file after the object', () => {
    expect(csvFileName('Account')).toBe('Account.csv')
    expect(csvFileName(undefined)).toBe('query.csv')
  })
})
