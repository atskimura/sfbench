import { describe, expect, it } from 'vitest'
import { diffWords } from './diff.ts'
import { initialAiDraft, switchProvider } from './draft.ts'

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
