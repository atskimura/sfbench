// docs/apex.md: when to ask before running, the screen's state, the debug log and the colors.
import { StringStream } from '@codemirror/language'
import { describe, expect, it } from 'vitest'
import success from '../../server/sf/__fixtures__/apex-run-success.json'
import type { ApexHistoryEntry, ApexOutcome } from '../../shared/api.ts'
import { confirmReasons } from '../execution.ts'
import { firstLineOf, initialState, reducer } from './apexState.ts'
import { needsApexConfirm, sameCode } from './confirm.ts'
import { apexParser } from './language.ts'
import { findMatches, logEntries, MAX_MATCHES, userDebugOnly } from './log.ts'

const entry = (outcome: ApexOutcome, code = 'insert new Account(Name = \'A\');'): ApexHistoryEntry => ({ id: 'a1', code, sentAt: '2026-10-18T00:00:00.000Z', outcome })
const code = "insert new Account(Name = 'A');"
const loaded = { isProduction: false, history: [] as ApexHistoryEntry[], historyLoaded: true }

describe('needsApexConfirm', () => {
  it('asks in production only, of the orgs', () => {
    expect(needsApexConfirm(code, { ...loaded, isProduction: true })).toEqual(['production'])
    expect(needsApexConfirm(code, loaded)).toEqual([])
  })

  it('asks when the same code has an unknown or pending outcome, whatever its line ends', () => {
    expect(needsApexConfirm(code, { ...loaded, history: [entry({ state: 'unknown', reason: 'timeout' })] })).toEqual(['unknownOutcome'])
    expect(needsApexConfirm('a;\nb;', { ...loaded, history: [entry({ state: 'pending' }, 'a;\r\nb;')] })).toEqual(['unknownOutcome'])
    expect(needsApexConfirm(code, { ...loaded, history: [entry({ state: 'done', result: 'success', elapsedMs: 1 })] })).toEqual([])
  })

  it('asks when another run is still pending, even for other code, but not for another unknown one', () => {
    expect(needsApexConfirm('System.debug(1);', { ...loaded, history: [entry({ state: 'pending' })] })).toEqual(['otherPending'])
    expect(needsApexConfirm('System.debug(1);', { ...loaded, history: [entry({ state: 'unknown', reason: 'error' })] })).toEqual([])
  })

  it('asks before the history has been loaded', () => {
    expect(needsApexConfirm(code, { ...loaded, historyLoaded: false })).toEqual(['historyUnknown'])
  })

  it('compares code as written, with LF line ends', () => {
    expect(sameCode('a;\r\nb;', 'a;\nb;')).toBe(true)
    expect(sameCode('a;', 'a; ')).toBe(false)
  })
})

describe('confirmReasons', () => {
  it('never asks for a run that changes no data', () => {
    expect(confirmReasons({ changesData: false, isProduction: true, historyLoaded: false, sameUnknown: true, otherPending: true })).toEqual([])
  })

  it('gives the reasons in a fixed order', () => {
    expect(confirmReasons({ changesData: true, isProduction: true, historyLoaded: false, sameUnknown: true, otherPending: true })).toEqual([
      'historyUnknown',
      'unknownOutcome',
      'otherPending',
      'production',
    ])
  })
})

describe('Apex screen state', () => {
  const run = { code, ranAt: '2026-10-18T00:00:00.000Z' }

  it('drops the confirmation and the launch notice when running starts', () => {
    const asked = reducer(initialState(true), { type: 'confirm', code, reasons: ['production'] })
    expect(asked.confirming).toEqual({ code, reasons: ['production'] })
    expect(reducer(asked, { type: 'running' })).toMatchObject({ confirming: undefined, launchNotice: false })
  })

  it('keeps the result when a confirmation is cancelled', () => {
    const shown = reducer(initialState(false), { type: 'result', result: { state: 'unknown', run, message: 'm' } })
    const cancelled = reducer(reducer(shown, { type: 'confirm', code, reasons: [] }), { type: 'confirmCancelled' })
    expect(cancelled.result).toEqual({ state: 'unknown', run, message: 'm' })
  })

  it('shows the first line that is not blank', () => {
    expect(firstLineOf('\n  \n  Integer x = 1;\nx++;')).toBe('Integer x = 1;')
    expect(firstLineOf('  \n')).toBe('')
  })
})

// Recorded from sf apex run (src/server/sf/__fixtures__).
const log = success.result.logs

describe('debug log', () => {
  it('splits a recorded log into entries, the header lines first', () => {
    const entries = logEntries(log)
    expect(entries[0]).toMatch(/^68\.0 APEX_CODE/)
    expect(entries[0]).toContain('Execute Anonymous:')
    expect(entries.find((e) => e.includes('LIMIT_USAGE_FOR_NS'))).toContain('Number of SOQL queries')
  })

  it('keeps the USER_DEBUG entries only, a multi-line value whole', () => {
    expect(userDebugOnly(log).split('\n')).toEqual(['16:52:14.24 (31275249)|USER_DEBUG|[2]|DEBUG|rows 2', '16:52:14.24 (31338780)|USER_DEBUG|[3]|DEBUG|line1', 'line2'])
  })

  it('finds a query ignoring case, and nothing for an empty one', () => {
    expect(findMatches('Rows ROWS rows', 'rows')).toEqual([
      { from: 0, to: 4 },
      { from: 5, to: 9 },
      { from: 10, to: 14 },
    ])
    expect(findMatches('abc', '')).toEqual([])
  })

  it('stops at the most matches it marks', () => {
    expect(findMatches('a'.repeat(MAX_MATCHES + 5), 'a')).toHaveLength(MAX_MATCHES)
  })

  it('keeps match positions right when lower case changes the length', () => {
    // 'İ' becomes two characters in lower case.
    expect(findMatches('İx x', 'x')).toEqual([
      { from: 1, to: 2 },
      { from: 3, to: 4 },
    ])
  })
})

/** The token of each word in a line, as the editor colors it. */
function tokens(line: string, state = apexParser.startState!(2)): [string, string | null][] {
  const stream = new StringStream(line, 2, 2)
  const out: [string, string | null][] = []
  while (!stream.eol()) {
    const style = apexParser.token(stream, state)
    const text = stream.current()
    if (text.trim()) out.push([text, style])
    stream.start = stream.pos
  }
  return out
}

describe('Apex colors', () => {
  it('colors keywords in any case, types, strings and annotations', () => {
    expect(tokens("PUBLIC String s = 'it\\'s'; @future")).toEqual([
      ['PUBLIC', 'keyword'],
      ['String', 'typeName'],
      ['s', null],
      ['=', null],
      ["'it\\'s'", 'string'],
      [';', null],
      ['@future', 'meta'],
    ])
  })

  it('colors SOQL inside brackets, with its bound variables', () => {
    expect(tokens('[SELECT Id FROM Account WHERE Name = :name]')).toEqual([
      ['[', 'bracket'],
      ['SELECT', 'keyword'],
      ['Id', null],
      ['FROM', 'keyword'],
      ['Account', null],
      ['WHERE', 'keyword'],
      ['Name', null],
      ['=', null],
      [':name', 'variableName'],
      [']', 'bracket'],
    ])
  })

  it('carries a block comment over lines', () => {
    const state = apexParser.startState!(2)
    expect(tokens('/* start', state)).toEqual([
      ['/*', 'comment'],
      [' start', 'comment'],
    ])
    expect(tokens('end */ x', state)).toEqual([
      ['end */', 'comment'],
      ['x', null],
    ])
  })
})
