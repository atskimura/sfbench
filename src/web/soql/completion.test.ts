import { describe, expect, it } from 'vitest'
import type { FieldDescribe } from '../api/client.ts'
import { fieldCandidates, fromObjectOf, keywordCandidates } from './completion.ts'

const field = (name: string, label: string): FieldDescribe => ({
  name,
  label,
  type: 'string',
  relationshipName: null,
  referenceTo: [],
})

describe('fromObjectOf', () => {
  it('finds the outer FROM even while typing and with subqueries', () => {
    expect(fromObjectOf('SELECT Id, (SELECT Id FROM Contacts) FROM Account WHERE')).toBe('Account')
    expect(fromObjectOf('SELECT Name, ')).toBeUndefined()
    expect(fromObjectOf("SELECT Id FROM Opportunity WHERE Name = 'from Lead'")).toBe('Opportunity')
  })
})

describe('fieldCandidates', () => {
  const fields = [field('Name', '取引先名'), field('acme__Total__c', '合計'), field('Industry', '業種')]

  it('matches the API name or the label, and inserts the API name', () => {
    expect(fieldCandidates(fields, '業', { ns: null, omitNamespace: true }).map((c) => c.insert)).toEqual(['Industry'])
    expect(fieldCandidates(fields, 'name', { ns: null, omitNamespace: true }).map((c) => c.label)).toEqual(['Name / 取引先名'])
  })

  it('omits the namespace in the inserted name when the setting is on', () => {
    expect(fieldCandidates(fields, '合計', { ns: 'acme', omitNamespace: true })[0].insert).toBe('Total__c')
  })
})

describe('keywordCandidates', () => {
  it('matches keywords', () => {
    expect(keywordCandidates('order').map((c) => c.insert)).toEqual(['ORDER BY'])
  })
})
