// The proposal and failure rows of docs/ai.md "画面の状態と遷移".
import { describe, expect, it } from 'vitest'
import { initialState, reducer, type Proposal } from './aiState.ts'

const proposal = (soql: string): Proposal => ({ soql, explanation: '', tooling: false, prompt: 'p' })
const shown = reducer(initialState, { type: 'done', proposal: proposal('SELECT Id FROM Account') })

describe('AI proposal and failure', () => {
  it('shows a new proposal on success and drops the failure', () => {
    const failed = reducer(initialState, { type: 'failed', failure: { message: 'boom' } })
    const next = reducer(failed, { type: 'done', proposal: proposal('SELECT Name FROM Account') })
    expect(next).toEqual({ proposal: proposal('SELECT Name FROM Account'), failure: undefined })
  })

  it('drops the proposal on failure and shows the failure', () => {
    expect(reducer(shown, { type: 'failed', failure: { message: 'boom' } })).toEqual({ proposal: undefined, failure: { message: 'boom' } })
  })

  it('shows nothing for a failure shown elsewhere', () => {
    expect(reducer(shown, { type: 'failed', failure: undefined })).toEqual(initialState)
  })

  it('drops both when Cancel stopped a request', () => {
    expect(reducer(shown, { type: 'cancelled' })).toEqual(initialState)
  })

  it('drops the proposal on Discard and on Replace', () => {
    expect(reducer(shown, { type: 'discarded' }).proposal).toBeUndefined()
    expect(reducer(shown, { type: 'applied' }).proposal).toBeUndefined()
  })
})
