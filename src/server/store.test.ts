import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { statSync } from 'node:fs'
import { MAX_HISTORY, addApexPending, addHistory, addRestPending, finishApex, loadApexHistory, AiSettingsError, finishRest, historyFile, loadHistory, loadRestHistory, loadSettings, mergeAiSettings, saveSettings, settingsView } from './store.ts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sfbench-store-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const entry = (soql: string, executedAt = '2026-10-16T00:00:00.000Z') => ({
  soql,
  tooling: false,
  queryAll: false,
  executedAt,
})

describe('history', () => {
  it('keeps the request to the AI when the same query runs again without one, even after Format', () => {
    addHistory(dir, 'u@example.com', { ...entry('SELECT Id FROM Account'), prompt: 'list accounts' })
    addHistory(dir, 'u@example.com', entry('SELECT Id\nFROM Account', '2026-10-17T00:00:00.000Z'))
    expect(loadHistory(dir, 'u@example.com')).toHaveLength(1)
    expect(loadHistory(dir, 'u@example.com')[0].prompt).toBe('list accounts')
  })

  it('keeps the newest first and moves a repeated query to the top', () => {
    addHistory(dir, 'u@example.com', entry('SELECT Id FROM Account'))
    addHistory(dir, 'u@example.com', entry('SELECT Id FROM Contact'))
    addHistory(dir, 'u@example.com', entry('SELECT Id FROM Account', '2026-10-17T00:00:00.000Z'))
    expect(loadHistory(dir, 'u@example.com').map((e) => e.soql)).toEqual([
      'SELECT Id FROM Account',
      'SELECT Id FROM Contact',
    ])
  })

  it('treats the same query with a different API as a different entry', () => {
    addHistory(dir, 'u@example.com', entry('SELECT Id FROM ApexClass'))
    addHistory(dir, 'u@example.com', { ...entry('SELECT Id FROM ApexClass'), tooling: true })
    expect(loadHistory(dir, 'u@example.com')).toHaveLength(2)
  })

  it(`keeps at most ${MAX_HISTORY} entries per org`, () => {
    for (let i = 0; i < MAX_HISTORY + 5; i++) addHistory(dir, 'u@example.com', entry(`SELECT Id FROM T${i}__c`))
    const entries = loadHistory(dir, 'u@example.com')
    expect(entries).toHaveLength(MAX_HISTORY)
    expect(entries[0].soql).toBe(`SELECT Id FROM T${MAX_HISTORY + 4}__c`)
  })

  it('makes a safe file name from the username', () => {
    expect(historyFile(dir, '../evil/u+1@example.com')).toBe(join(dir, '.._evil_u_1@example.com.json'))
  })
})

describe('settings', () => {
  it('defaults to omitting the namespace', () => {
    expect(loadSettings(join(dir, 'settings.json'))).toEqual({ omitNamespace: true, requestTimeoutSeconds: 120 })
  })

  it('round-trips', () => {
    saveSettings(join(dir, 'settings.json'), { omitNamespace: false, requestTimeoutSeconds: 300 })
    expect(loadSettings(join(dir, 'settings.json'))).toEqual({ omitNamespace: false, requestTimeoutSeconds: 300 })
  })

  it('falls back to the default for an out-of-range timeout', () => {
    saveSettings(join(dir, 'settings.json'), { omitNamespace: true, requestTimeoutSeconds: 5 })
    expect(loadSettings(join(dir, 'settings.json')).requestTimeoutSeconds).toBe(120)
  })
})

describe('AI settings', () => {
  const saved = { provider: 'anthropic' as const, model: 'claude-x', apiKey: 'sk-ant', keyProvider: 'anthropic' as const }

  it('never shows the key to the web UI', () => {
    const view = settingsView({ omitNamespace: true, requestTimeoutSeconds: 120, ai: saved })
    expect(view.ai).toEqual({ provider: 'anthropic', model: 'claude-x', hasApiKey: true, keyProvider: 'anthropic' })
    expect(JSON.stringify(view)).not.toContain('sk-ant')
  })

  it('keeps the saved key when none is sent, and removes it with null', () => {
    expect(mergeAiSettings(saved, { provider: 'anthropic', model: 'claude-y' })).toEqual({ ...saved, model: 'claude-y' })
    expect(mergeAiSettings(saved, { provider: 'anthropic', apiKey: null })).toEqual({ provider: 'anthropic', model: 'claude-x' })
  })

  it('drops the key when another provider is chosen, but keeps it through Off', () => {
    expect(mergeAiSettings(saved, { provider: 'openai', model: 'gpt-x' })).toEqual({ provider: 'openai', model: 'gpt-x' })
    const off = mergeAiSettings(saved, { provider: 'off' })
    expect(off).toEqual({ ...saved, provider: 'off' })
    expect(mergeAiSettings(off, { provider: 'anthropic' })).toEqual(saved)
  })

  it('takes a new key for the chosen provider', () => {
    expect(mergeAiSettings(undefined, { provider: 'openai', model: 'gpt-x', apiKey: ' sk-1 ' })).toEqual({
      provider: 'openai',
      model: 'gpt-x',
      apiKey: 'sk-1',
      keyProvider: 'openai',
    })
  })

  it('asks for a model and rejects unknown providers', () => {
    expect(() => mergeAiSettings(undefined, { provider: 'anthropic' })).toThrow(AiSettingsError)
    expect(() => mergeAiSettings(undefined, { provider: 'gemini', model: 'x' })).toThrow(AiSettingsError)
  })

  it('does not load a key saved for another provider', () => {
    const file = join(dir, 'settings.json')
    saveSettings(file, { omitNamespace: true, requestTimeoutSeconds: 120, ai: { ...saved, provider: 'openai' } })
    expect(loadSettings(file).ai).toEqual({ provider: 'openai', model: 'claude-x' })
  })

  it('saves the file readable by the owner only', () => {
    const file = join(dir, 'settings.json')
    saveSettings(file, { omitNamespace: true, requestTimeoutSeconds: 120, ai: saved })
    expect(loadSettings(file).ai).toEqual(saved)
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
  })
})

// docs/rest.md "実行履歴"
describe('REST history', () => {
  const request = { method: 'POST' as const, path: '/services/data/v66.0/sobjects/Account', headers: {}, body: '{"Name":"A"}' }

  it('records a request as pending before it is sent, and writes how it ended', () => {
    const id = addRestPending(dir, 'u@example.com', request, 'boot-1')
    expect(loadRestHistory(dir, 'u@example.com', 'boot-1')[0]).toMatchObject({ id, method: 'POST', body: '{"Name":"A"}', outcome: { state: 'pending' } })
    finishRest(dir, 'u@example.com', id, { state: 'done', status: 201, elapsedMs: 300 })
    expect(loadRestHistory(dir, 'u@example.com', 'boot-1')[0].outcome).toEqual({ state: 'done', status: 201, elapsedMs: 300 })
  })

  it('keeps the same request sent twice as two records', () => {
    addRestPending(dir, 'u@example.com', request, 'boot-1')
    addRestPending(dir, 'u@example.com', request, 'boot-1')
    expect(loadRestHistory(dir, 'u@example.com', 'boot-1')).toHaveLength(2)
  })

  it('removes the record of a request Salesforce never processed', () => {
    const id = addRestPending(dir, 'u@example.com', request, 'boot-1')
    finishRest(dir, 'u@example.com', id, undefined)
    expect(loadRestHistory(dir, 'u@example.com', 'boot-1')).toEqual([])
  })

  it('shows a request left pending by a server that stopped as unknown', () => {
    addRestPending(dir, 'u@example.com', request, 'boot-1')
    expect(loadRestHistory(dir, 'u@example.com', 'boot-2')[0].outcome).toEqual({ state: 'unknown', reason: 'stopped' })
  })

  it('does not keep a long body, and drops damaged records', () => {
    addRestPending(dir, 'u@example.com', { ...request, body: JSON.stringify({ x: 'y'.repeat(40_000) }) }, 'boot-1')
    const [entry] = loadRestHistory(dir, 'u@example.com', 'boot-1')
    expect(entry.body).toBeUndefined()
    expect(entry.bodyOmitted).toBe(true)
    writeFileSync(historyFile(dir, 'v@example.com'), JSON.stringify([{ id: 1 }, { ...entry, method: 'TRACE' }, entry]))
    expect(loadRestHistory(dir, 'v@example.com', 'boot-1')).toHaveLength(1)
  })

  it('does not add back a record that is gone', () => {
    finishRest(dir, 'u@example.com', 'missing', { state: 'unknown', reason: 'timeout' })
    expect(loadRestHistory(dir, 'u@example.com', 'boot-1')).toEqual([])
  })
})

// docs/apex.md "実行履歴"
describe('Apex history', () => {
  it('records the whole code as pending, writes how it ended, and removes a run that never ran', () => {
    const id = addApexPending(dir, 'u@example.com', "System.debug('a');", 'boot-1')
    expect(loadApexHistory(dir, 'u@example.com', 'boot-1')[0]).toMatchObject({ id, code: "System.debug('a');", outcome: { state: 'pending' } })
    finishApex(dir, 'u@example.com', id, { state: 'done', result: 'runtimeError', exceptionType: 'System.MathException', line: 1, elapsedMs: 10 })
    expect(loadApexHistory(dir, 'u@example.com', 'boot-1')[0].outcome).toMatchObject({ state: 'done', exceptionType: 'System.MathException' })
    const other = addApexPending(dir, 'u@example.com', 'x', 'boot-1')
    finishApex(dir, 'u@example.com', other, undefined)
    expect(loadApexHistory(dir, 'u@example.com', 'boot-1')).toHaveLength(1)
  })

  it('shows a run left pending by a server that stopped as unknown', () => {
    addApexPending(dir, 'u@example.com', 'x', 'boot-1')
    expect(loadApexHistory(dir, 'u@example.com', 'boot-2')[0].outcome).toEqual({ state: 'unknown', reason: 'stopped' })
  })
})
