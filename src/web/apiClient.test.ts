import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiRequestError } from './apiClient.ts'

afterEach(() => vi.unstubAllGlobals())

describe('apiClient', () => {
  it('reports ABORTED when the signal was aborted, even though a response arrived', async () => {
    const abort = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        // The response is already here when the caller gives up.
        abort.abort()
        return new Response(JSON.stringify({ entries: [] }), { status: 200 })
      }),
    )
    const error = await api.query('u', { soql: 'SELECT Id FROM Account' }, abort.signal).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect((error as ApiRequestError).code).toBe('ABORTED')
  })

  it('reports ABORTED for a late failure too', async () => {
    const abort = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        abort.abort()
        return new Response(JSON.stringify({ error: { code: 'SALESFORCE_ERROR', message: 'x' } }), { status: 400 })
      }),
    )
    const error = await api.query('u', { soql: 'x' }, abort.signal).catch((e: unknown) => e)
    expect((error as ApiRequestError).code).toBe('ABORTED')
  })
})
