// The REST API screen's rules (docs/rest.md "送信の流れ").
import { describe, expect, it } from 'vitest'
import type { RestHistoryEntry } from '../../shared/api.ts'
import { restMayChangeData } from './changes.ts'
import { needsConfirm } from './confirm.ts'
import { formatJson, responseText } from './json.ts'
import { draftOf, snapshotOf } from './request.ts'
import { initialState, reducer } from './restState.ts'

const path = '/services/data/v66.0/sobjects/Account'
const entry = (outcome: RestHistoryEntry['outcome'], body?: string): RestHistoryEntry => ({
  id: 'r1',
  method: 'POST',
  path,
  ...(body !== undefined ? { body } : {}),
  sentAt: '2026-10-18T00:00:00.000Z',
  outcome,
})

describe('restMayChangeData', () => {
  it('takes every method but GET, and the GETs that run code', () => {
    expect(restMayChangeData('GET', path)).toBe(false)
    expect(restMayChangeData('DELETE', path)).toBe(true)
    expect(restMayChangeData('GET', '/services/apexrest/orders/close')).toBe(true)
    expect(restMayChangeData('GET', '/services/data/v66.0/tooling/executeAnonymous/?anonymousBody=x')).toBe(true)
  })
})

describe('snapshotOf', () => {
  it('sends no body with a method that has none, and drops header rows without a name', () => {
    const request = snapshotOf({ method: 'GET', path: ` ${path} `, headers: [{ name: 'X-A', value: '1' }, { name: ' ', value: 'x' }], body: '{"Name":"A"}' })
    expect(request).toEqual({ method: 'GET', path, headers: { 'X-A': '1' } })
  })

  it('sends the body of a POST as written', () => {
    expect(snapshotOf({ method: 'POST', path, headers: [], body: '{"N":123456789012345678}' }).body).toBe('{"N":123456789012345678}')
  })

  it('puts a history entry back into the fields', () => {
    expect(draftOf({ method: 'PATCH', path, headers: { 'x-a': '1' }, body: '{}' })).toEqual({ method: 'PATCH', path, headers: [{ name: 'x-a', value: '1' }], body: '{}' })
  })
})

describe('needsConfirm', () => {
  const post = { method: 'POST' as const, path, headers: {}, body: '{"Name":"A"}' }

  it('asks in production only for a request that may change data', () => {
    expect(needsConfirm(post, { isProduction: true, history: [] })).toEqual(['production'])
    expect(needsConfirm({ method: 'GET', path, headers: {} }, { isProduction: true, history: [] })).toEqual([])
    expect(needsConfirm(post, { isProduction: false, history: [] })).toEqual([])
  })

  it('asks before sending again a request whose outcome is not known, in any org', () => {
    expect(needsConfirm(post, { isProduction: false, history: [entry({ state: 'unknown', reason: 'timeout' }, post.body)] })).toEqual(['unknownOutcome'])
    expect(needsConfirm(post, { isProduction: false, history: [entry({ state: 'pending' }, post.body)] })).toEqual(['unknownOutcome'])
  })

  it('asks for a record whose body was too long to keep', () => {
    const omitted = { ...entry({ state: 'unknown', reason: 'timeout' }), bodyOmitted: true }
    expect(needsConfirm(post, { isProduction: false, history: [omitted] })).toEqual(['unknownOutcome'])
  })

  it('does not ask for a request that ended, or for another body', () => {
    expect(needsConfirm(post, { isProduction: false, history: [entry({ state: 'done', status: 201, elapsedMs: 1 }, post.body)] })).toEqual([])
    expect(needsConfirm(post, { isProduction: false, history: [entry({ state: 'unknown', reason: 'timeout' }, '{"Name":"B"}')] })).toEqual([])
  })
})

describe('REST screen state', () => {
  const request = { method: 'POST' as const, path, headers: {} }

  it('drops the confirmation and the launch notice when sending starts', () => {
    const asked = reducer(initialState(true), { type: 'confirm', request, reasons: ['production'] })
    expect(reducer(asked, { type: 'sending' })).toEqual({ ...initialState(false), confirming: undefined })
  })

  it('keeps the notice when the confirmation is cancelled', () => {
    const asked = reducer(initialState(true), { type: 'confirm', request, reasons: ['production'] })
    expect(reducer(asked, { type: 'confirmCancelled' })).toEqual(initialState(true))
  })

  it('empties the result when Cancel stopped a request', () => {
    const shown = reducer(initialState(false), { type: 'result', result: { state: 'unknown', request, message: 'x' } })
    expect(reducer(shown, { type: 'cancelled' }).result).toEqual({ state: 'idle' })
  })
})

describe('formatJson', () => {
  it('indents JSON and keeps numbers as written', () => {
    expect(formatJson('{"a":123456789012345678,"b":[1.50,{}],"c":"x,{y}:z","d":[]}')).toBe(
      '{\n  "a": 123456789012345678,\n  "b": [\n    1.50,\n    {}\n  ],\n  "c": "x,{y}:z",\n  "d": []\n}',
    )
  })

  it('keeps escaped quotes inside strings', () => {
    expect(formatJson('{"a":"say \\"hi\\""}')).toBe('{\n  "a": "say \\"hi\\""\n}')
  })

  it('leaves text that is not JSON', () => {
    expect(formatJson('Name\nA')).toBeUndefined()
    expect(responseText('<html>')).toEqual({ text: '<html>', json: false, cut: false })
  })
})
