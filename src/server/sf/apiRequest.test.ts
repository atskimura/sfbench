import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseIncludedResponse } from './apiRequest.ts'
import { isAuthErrorMessage } from './errors.ts'
import { lastErrorLine } from './run.ts'

const fixture = (name: string) => readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf8')

describe('parseIncludedResponse', () => {
  it('reads the status, headers and JSON body of a successful query', () => {
    const res = parseIncludedResponse(fixture('api-request-query-200.txt'))
    expect(res?.status).toBe(200)
    expect(res?.headers['sforce-limit-info']).toBe('api-usage=39/50000')
    expect(JSON.parse(res!.body)).toMatchObject({ totalSize: 1, records: [{ Name: 'Edge Communications' }] })
  })

  it('reads an error response, which sf prints even though it exits with code 1', () => {
    const res = parseIncludedResponse(fixture('api-request-query-400.txt'))
    expect(res?.status).toBe(400)
    expect(JSON.parse(res!.body)[0].errorCode).toBe('INVALID_TYPE')
  })

  it('accepts a blank line between the headers and the body', () => {
    const res = parseIncludedResponse('HTTP/1.1 200\ncontent-type: application/json\n\n{"a":1}\n')
    expect(res).toEqual({ status: 200, headers: { 'content-type': 'application/json' }, body: '{"a":1}' })
  })

  it('handles an empty body', () => {
    expect(parseIncludedResponse('HTTP/1.1 204\ndate: x\n')).toEqual({ status: 204, headers: { date: 'x' }, body: '' })
  })

  it('returns undefined when sf printed no HTTP response', () => {
    expect(parseIncludedResponse('')).toBeUndefined()
  })
})

describe('sf error messages', () => {
  it('extracts the message from human-readable stderr', () => {
    const message = lastErrorLine(fixture('api-request-auth-error.stderr.txt'))
    expect(message).toBe(
      'Unable to refresh session due to: Error authenticating with the refresh token due to: expired access/refresh token',
    )
    expect(isAuthErrorMessage(message!)).toBe(true)
  })

  it('does not treat other errors as auth errors', () => {
    expect(isAuthErrorMessage('No default environment found. Use -o or --target-org to specify an environment.')).toBe(
      false,
    )
  })
})
