import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_HISTORY, addHistory, historyFile, loadHistory, loadSettings, saveSettings } from './store.ts'

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
