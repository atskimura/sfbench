import { describe, expect, it } from 'vitest'
import { addNamespace, nameKey, stripNamespace } from './namespace.ts'
import {
  clearAllFields,
  formatSoql,
  initialSoql,
  parseSoql,
  selectAllFields,
  selectionOf,
  toggleField,
  toggleSubquery,
} from './selection.ts'

const plain = { ns: null, omitNamespace: true }
const acme = { ns: 'acme', omitNamespace: true }
const oneLine = (s: string | undefined) =>
  s?.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim()

describe('namespace', () => {
  it('strips and adds the prefix on each part, only for custom names', () => {
    expect(stripNamespace('acme__Invoice__r.acme__Total__c', 'acme')).toBe('Invoice__r.Total__c')
    expect(addNamespace('Invoice__r.Name', 'acme')).toBe('acme__Invoice__r.Name')
    expect(addNamespace('Account.Name', 'acme')).toBe('Account.Name')
    expect(nameKey('ACME__Total__c', 'acme')).toBe('total__c')
  })
})

describe('selection', () => {
  it('reads the FROM object, fields, parent fields and subqueries, ignoring case', () => {
    const q = parseSoql('select id, account.name, (select Id, Name from contacts) from opportunity')!
    const s = selectionOf(q, null)
    expect(s.object).toBe('opportunity')
    expect([...s.fields]).toEqual(['id', 'account.name'])
    expect([...s.subqueries.get('contacts')!]).toEqual(['id', 'name'])
  })

  it('treats names with and without the namespace as the same', () => {
    const s = selectionOf(parseSoql('SELECT acme__Total__c, Total2__c FROM acme__Invoice__c')!, 'acme')
    expect([...s.fields]).toEqual(['total__c', 'total2__c'])
  })

  it('returns undefined for SOQL that cannot be parsed', () => {
    expect(parseSoql('SELECT Id FROM Account WHERE')).toBeUndefined()
    expect(parseSoql('   ')).toBeUndefined()
  })
})

describe('toggleField', () => {
  it('adds and removes a field, matching case-insensitively', () => {
    const added = toggleField('SELECT Id FROM Account', { name: 'Name', relationships: [] }, plain)
    expect(oneLine(added)).toBe('SELECT Id, Name FROM Account')
    expect(oneLine(toggleField('select id, name from account', { name: 'Name', relationships: [] }, plain))).toBe(
      'SELECT id FROM account',
    )
  })

  it('adds a parent field with its relationship path', () => {
    const added = toggleField('SELECT Id FROM Contact', { name: 'Name', relationships: ['Account', 'Owner'] }, plain)
    expect(oneLine(added)).toBe('SELECT Id, Account.Owner.Name FROM Contact')
  })

  it('adds a field to a subquery, creating the subquery if needed', () => {
    const first = toggleField('SELECT Id FROM Account', { name: 'Email', relationships: [] }, plain, 'Contacts')
    expect(oneLine(first)).toBe('SELECT Id, (SELECT Email FROM Contacts) FROM Account')
    const second = toggleField(first!, { name: 'Name', relationships: [] }, plain, 'contacts')
    expect(oneLine(second)).toBe('SELECT Id, (SELECT Email, Name FROM Contacts) FROM Account')
  })

  it('omits the namespace when the setting is on', () => {
    const added = toggleField('SELECT Id FROM acme__Invoice__c', { name: 'acme__Total__c', relationships: [] }, acme)
    expect(oneLine(added)).toBe('SELECT Id, Total__c FROM acme__Invoice__c')
    const kept = toggleField('SELECT Id FROM Invoice__c', { name: 'acme__Total__c', relationships: [] }, { ns: 'acme', omitNamespace: false })
    expect(oneLine(kept)).toBe('SELECT Id, acme__Total__c FROM Invoice__c')
  })

  it('removes a field written with the namespace when clicked without it', () => {
    const removed = toggleField('SELECT Id, acme__Total__c FROM Invoice__c', { name: 'Total__c', relationships: [] }, acme)
    expect(oneLine(removed)).toBe('SELECT Id FROM Invoice__c')
  })

  it('leaves unparsable SOQL alone', () => {
    expect(toggleField('SELECT Id, FROM', { name: 'Name', relationships: [] }, plain)).toBeUndefined()
  })
})

describe('other edits', () => {
  it('toggles a child relationship subquery', () => {
    const added = toggleSubquery('SELECT Id FROM Account', 'Contacts', plain)
    expect(oneLine(added)).toBe('SELECT Id, (SELECT Id FROM Contacts) FROM Account')
    expect(oneLine(toggleSubquery(added!, 'CONTACTS', plain))).toBe('SELECT Id FROM Account')
  })

  it('selects all fields (dropping parent fields and subqueries) and clears to Id', () => {
    const all = selectAllFields('SELECT Id, Owner.Name, (SELECT Id FROM Contacts) FROM Account WHERE Name != null', ['Id', 'Name'], plain)
    expect(oneLine(all)).toBe('SELECT Id, Name FROM Account WHERE Name != NULL')
    expect(oneLine(clearAllFields(all!))).toBe('SELECT Id FROM Account WHERE Name != NULL')
  })

  it('writes the initial SOQL for an object', () => {
    expect(oneLine(initialSoql('acme__Invoice__c', acme))).toBe('SELECT Id FROM Invoice__c')
  })

  it('formats SOQL', () => {
    expect(formatSoql("select id,name from account where name = 'x'")).toBe("SELECT id, name\nFROM account\nWHERE name = 'x'")
    expect(formatSoql('SELECT')).toBeUndefined()
  })
})
