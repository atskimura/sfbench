import { describe, expect, it } from 'vitest'
import type { FieldDescribe, SObjectDescribe } from '../api/client.ts'
import { contextCandidates, fieldCandidates, keywordCandidates, type Describer } from './completion.ts'
import { cursorInfo } from './context.ts'

const field = (name: string, label: string, ref?: { relationshipName: string; referenceTo: string[] }): FieldDescribe => ({
  name,
  label,
  type: ref ? 'reference' : 'string',
  relationshipName: ref?.relationshipName ?? null,
  referenceTo: ref?.referenceTo ?? [],
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

describe('contextCandidates', () => {
  const objects: Record<string, SObjectDescribe> = {
    Account: {
      name: 'Account',
      label: '取引先',
      fields: [
        field('Name', '取引先名'),
        field('OwnerId', '所有者 ID', { relationshipName: 'Owner', referenceTo: ['User'] }),
        field('BrandName', 'ブランド'),
      ],
      childRelationships: [
        { childSObject: 'Contact', field: 'AccountId', relationshipName: 'Contacts' },
        { childSObject: 'acme__Invoice__c', field: 'acme__Account__c', relationshipName: 'acme__Invoices__r' },
      ],
    },
    Contact: {
      name: 'Contact',
      label: '取引先責任者',
      fields: [field('LastName', '姓'), field('AccountId', '取引先 ID', { relationshipName: 'Account', referenceTo: ['Account'] })],
      childRelationships: [],
    },
    User: { name: 'User', label: 'ユーザー', fields: [field('Username', 'ユーザー名')], childRelationships: [] },
    acme__Invoice__c: { name: 'acme__Invoice__c', label: '請求書', fields: [field('acme__Total__c', '合計')], childRelationships: [] },
  }
  const describer: Describer = {
    objects: async () => [
      ...Object.values(objects).map((o) => ({ name: o.name, label: o.label, queryable: true })),
      { name: 'AccountShare', label: '取引先共有', queryable: false },
    ],
    describe: async (name) => {
      const o = objects[name]
      if (!o) throw new Error(`no ${name}`)
      return o
    },
  }
  const acme = { ns: 'acme', omitNamespace: true }
  const labels = async (text: string) =>
    (await contextCandidates(cursorInfo(text.replace('|', ''), text.indexOf('|')), describer, acme)).map((c) => c.label)

  it('lists queryable objects after FROM, matching the API name or the label', async () => {
    expect(await labels('SELECT Id FROM 取引|')).toEqual(['Account / 取引先', 'Contact / 取引先責任者'])
    expect(await labels('SELECT Id FROM inv|')).toEqual(['Invoice__c / 請求書'])
  })

  it('lists fields of the FROM object, then keywords', async () => {
    expect(await labels('SELECT Na| FROM Account')).toEqual(['Name / 取引先名', 'BrandName / ブランド'])
    expect(await labels('SELECT Id FROM Account WHERE Na| ')).toEqual(['Name / 取引先名', 'BrandName / ブランド'])
    expect(await labels('SELECT Id FROM Account WHER|')).toEqual(['WHERE'])
  })

  it('follows parent relationships, and lists only fields after a dot', async () => {
    expect(await labels('SELECT Account.Owner.| FROM Contact')).toEqual(['Username / ユーザー名'])
    expect(await labels('SELECT c.Account.Na| FROM Contact c')).toEqual(['Name / 取引先名', 'BrandName / ブランド'])
    expect(await labels('SELECT Account.Nothing.| FROM Contact')).toEqual([])
  })

  it('lists child relationships after FROM in a subquery, and the child fields inside it', async () => {
    expect(await labels('SELECT Id, (SELECT Id FROM | ) FROM Account')).toEqual(['Contacts / Contact', 'Invoices__r / acme__Invoice__c'])
    expect(await labels('SELECT Id, (SELECT 姓| FROM Contacts) FROM Account')).toEqual(['LastName / 姓'])
    expect(await labels('SELECT Id, (SELECT 合| FROM Invoices__r) FROM Account')).toEqual(['Total__c / 合計'])
  })

  it('ranks keywords that start with the word before fields that only contain it', async () => {
    expect(await labels("SELECT Id FROM Account WHERE Name = 'x' AN|")).toEqual(['AND', 'BrandName / ブランド', 'FIELDS(STANDARD)'])
  })

  it('lists no keywords after a dot', async () => {
    expect(await labels('SELECT Id FROM Account LIMIT 1.|')).toEqual([])
  })

  it('lists only fields after the FROM alias and a dot', async () => {
    expect(await labels('SELECT a.| FROM Account a')).toEqual(['Name / 取引先名', 'OwnerId / 所有者 ID', 'BrandName / ブランド'])
  })

  it('puts names, then labels, that start with the word first', () => {
    const fields = [field('AccountName', '名前'), field('BillingName', '請求先の名前'), field('Name', '取引先名'), field('Note', '名前メモ')]
    expect(fieldCandidates(fields, 'name', acme).map((c) => c.insert)).toEqual(['Name', 'AccountName', 'BillingName'])
    expect(fieldCandidates(fields, '名前', acme).map((c) => c.insert)).toEqual(['AccountName', 'Note', 'BillingName'])
  })

  it('lists nothing but keywords when the FROM object is unknown', async () => {
    expect(await labels('SELECT Na| FROM Nothing')).toEqual(keywordCandidates('Na').map((c) => c.label))
  })
})
