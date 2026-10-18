// docs/ai.md "画面の状態と遷移": the rules for the request recorded with a run.
import { describe, expect, it } from 'vitest'
import { markFor, promptForRun } from './promptMark.ts'

const mark = markFor('SELECT Id, Name FROM Account', false, 'list accounts')

describe('prompt mark', () => {
  it('records the request while the query is the one put in', () => {
    expect(promptForRun(mark, 'SELECT Id, Name FROM Account', false)).toBe('list accounts')
  })

  it('still records it after Format, which only changes spaces', () => {
    expect(promptForRun(mark, 'SELECT\n  Id,\n  Name\nFROM Account\n', false)).toBe('list accounts')
  })

  it('still records it after Format changes case, symbols and a subquery', () => {
    const subquery = markFor("select Name, (select LastName from Contacts) from Account where Name IN ('a','b')", false, 'with contacts')
    const formatted = "SELECT Name, (\n\t\tSELECT LastName\n\t\tFROM Contacts\n\t)\nFROM Account\nWHERE Name IN ('a', 'b')"
    expect(promptForRun(subquery, formatted, false)).toBe('with contacts')
  })

  it('does not record it once a word changes', () => {
    expect(promptForRun(mark, 'SELECT Id FROM Account', false)).toBeUndefined()
  })

  it('does not record it with the other API', () => {
    expect(promptForRun(mark, 'SELECT Id, Name FROM Account', true)).toBeUndefined()
  })

  it('records nothing without a mark', () => {
    expect(promptForRun(undefined, 'SELECT Id FROM Account', false)).toBeUndefined()
  })

  it('makes no mark without a request, so that a query fixed from a hand-written one records nothing', () => {
    expect(markFor('SELECT Name FROM Account', false, undefined)).toBeUndefined()
    expect(markFor('SELECT Name FROM Account', false, '')).toBeUndefined()
  })
})
