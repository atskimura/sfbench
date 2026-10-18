import { describe, expect, it } from 'vitest'
import type { SObjectDescribe } from '../apiClient.ts'
import { diffWords } from './diff.ts'
import { initialAiDraft, switchProvider } from './draft.ts'
import { budgetLeft, objectInfo, objectList } from './objectInfo.ts'

const opportunity: SObjectDescribe = {
  name: 'acme__Deal__c',
  label: '商談',
  fields: [
    { name: 'Id', label: 'ID', type: 'id', relationshipName: null, referenceTo: [] },
    {
      name: 'acme__Stage__c',
      label: 'フェーズ',
      type: 'picklist',
      relationshipName: null,
      referenceTo: [],
      picklistValues: [
        { value: 'Open', active: true },
        { value: 'Old', active: false },
        { value: 'Won', active: true },
      ],
    },
    { name: 'AccountId', label: '取引先 ID', type: 'reference', relationshipName: 'Account', referenceTo: ['Account'] },
  ],
  childRelationships: [{ childSObject: 'acme__Line__c', field: 'acme__Deal__c', relationshipName: 'acme__Lines__r' }],
}
const acme = { ns: 'acme', omitNamespace: true }

describe('objectInfo', () => {
  it('writes one line per field without the namespace, with active picklist values and child relationships', () => {
    expect(objectInfo([opportunity], acme)).toBe(
      [
        'Object Deal__c (商談)',
        'Fields:',
        'Id id ID',
        'Stage__c picklist フェーズ [Open, Won]',
        'AccountId reference(Account) relationship Account 取引先 ID',
        'Child relationships:',
        'Lines__r -> Line__c',
      ].join('\n'),
    )
  })

  it('drops picklists, labels, child relationships, then types to fit the budget', () => {
    const full = objectInfo([opportunity], acme)
    const noPicklists = objectInfo([opportunity], acme, new TextEncoder().encode(full).length - 5)
    expect(noPicklists).not.toContain('[Open')
    expect(noPicklists).toContain('フェーズ')
    expect(objectInfo([opportunity], acme, 44)).toBe('Object Deal__c\nFields:\nId\nStage__c\nAccountId')
  })
})

describe('budget', () => {
  it('counts the other texts sent, and cuts whole lines when names alone do not fit', () => {
    expect(budgetLeft('a'.repeat(99_990))).toBe(10)
    expect(objectInfo([opportunity], acme, 25)).toBe('Object Deal__c\nFields:\nId')
  })
})

describe('objectList', () => {
  it('lists queryable objects without sharing, history, feed and change event objects', () => {
    const list = objectList(
      [
        { name: 'Account', label: '取引先', queryable: true },
        { name: 'AccountShare', label: '共有', queryable: true },
        { name: 'AccountHistory', label: '履歴', queryable: true },
        { name: 'acme__Deal__c', label: '商談', queryable: true },
        { name: 'Hidden', label: 'x', queryable: false },
      ],
      acme,
    )
    expect(list).toBe('Account (取引先)\nDeal__c (商談)')
  })
})

describe('diffWords', () => {
  it('ends a string being typed at the end of its line', () => {
    const parts = diffWords("SELECT Id FROM Account WHERE Name = 'Ac\nLIMIT 10", "SELECT Id FROM Account WHERE Name = 'Acme'\nLIMIT 10")
    expect(parts?.find((p) => p.kind === 'same' && p.text.includes('LIMIT'))).toBeTruthy()
  })

  it('shows a change of case inside a quoted string, such as a 15-character Id', () => {
    const parts = diffWords("SELECT Id FROM Account WHERE Id = '001xx000003DGb2'", "SELECT Id FROM Account WHERE Id = '001xx000003dgb2'")
    expect(parts?.filter((p) => p.kind !== 'same').map((p) => p.text.trim())).toEqual(["'001xx000003DGb2'", "'001xx000003dgb2'"])
  })

  it('marks removed and added words, ignoring case and keeping the spacing', () => {
    expect(diffWords('select Id from Account', 'SELECT Id, Name FROM Account LIMIT 10')).toEqual([
      { text: 'SELECT Id', kind: 'same' },
      { text: ', Name', kind: 'added' },
      { text: ' FROM Account', kind: 'same' },
      { text: ' LIMIT 10', kind: 'added' },
    ])
    expect(diffWords("SELECT Id FROM Account WHERE Name = 'a b'", "SELECT Id FROM Account WHERE Name = 'a c'")).toEqual([
      { text: 'SELECT Id FROM Account WHERE Name =', kind: 'same' },
      { text: " 'a b'", kind: 'removed' },
      { text: " 'a c'", kind: 'added' },
    ])
  })

  it('shows no diff when little is in common', () => {
    expect(diffWords('SELECT Id FROM Account', 'SELECT StageName, COUNT(Id) cnt FROM Opportunity GROUP BY StageName')).toBeUndefined()
  })

  it('gives up on texts too long to compare', () => {
    const long = Array.from({ length: 1100 }, (_, i) => `F${i}`).join(' ')
    expect(diffWords(long, long)).toBeUndefined()
  })
})

// docs/ai.md "設定画面の AI の欄": a model ID and a key belong to one provider.
describe('switchProvider', () => {
  const saved = { provider: 'anthropic' as const, model: 'claude-x', hasApiKey: true, keyProvider: 'anthropic' as const }

  it("empties the model and key for another provider, and brings back the saved provider's model", () => {
    const draft = { ...initialAiDraft(saved), apiKey: 'sk-ant-typed' }
    const openai = switchProvider(draft, 'openai', saved)
    expect(openai).toMatchObject({ provider: 'openai', model: '', apiKey: '' })
    expect(switchProvider(openai, 'anthropic', saved)).toMatchObject({ provider: 'anthropic', model: 'claude-x', apiKey: 'sk-ant-typed' })
  })

  it('keeps what was typed for each provider while the dialog is open, through Off too', () => {
    let draft = switchProvider(initialAiDraft(saved), 'openai', saved)
    draft = { ...draft, model: 'gpt-x', apiKey: 'sk-oa' }
    draft = switchProvider(switchProvider(draft, 'off', saved), 'openai', saved)
    expect(draft).toMatchObject({ provider: 'openai', model: 'gpt-x', apiKey: 'sk-oa' })
  })

  it('takes the model of a saved Off for the provider its key is for', () => {
    const off = { provider: 'off' as const, model: 'gpt-x', hasApiKey: true, keyProvider: 'openai' as const }
    expect(switchProvider(initialAiDraft(off), 'openai', off).model).toBe('gpt-x')
    expect(switchProvider(initialAiDraft(off), 'anthropic', off).model).toBe('')
  })
})
