import { describe, expect, it } from 'vitest'
import { SalesforceError, SalesforceTimeoutError, SalesforceUnreachableError } from '../salesforce.ts'
import { cacheControl, errorResponse, unknownOrg } from './server.ts'

describe('cacheControl', () => {
  it('caches only the hashed files under /assets/', () => {
    expect(cacheControl('/assets/index-abc123.js')).toContain('immutable')
    expect(cacheControl('/licenses.txt')).toBe('no-store')
    expect(cacheControl('/favicon.svg')).toBe('no-store')
    expect(cacheControl('/')).toBe('no-store')
  })
})

// The codes the web UI sorts by (docs/web.md "エラーの扱い").
describe('errorResponse', () => {
  it('tells a refusal from Salesforce from a timeout and a broken connection', () => {
    expect(errorResponse(new SalesforceError(400, [{ errorCode: 'INVALID_FIELD' }]))).toMatchObject({ status: 400, body: { error: { code: 'SALESFORCE_ERROR', status: 400 } } })
    expect(errorResponse(new SalesforceError(503, 'down'))).toMatchObject({ status: 502, body: { error: { code: 'SALESFORCE_ERROR', status: 503 } } })
    expect(errorResponse(new SalesforceTimeoutError())).toMatchObject({ status: 504, body: { error: { code: 'SALESFORCE_TIMEOUT' } } })
    expect(errorResponse(new SalesforceUnreachableError())).toMatchObject({ status: 502, body: { error: { code: 'SALESFORCE_UNREACHABLE' } } })
  })

  it('answers an unknown org apart from an unknown path', () => {
    expect(errorResponse(unknownOrg('gone@example.com'))).toMatchObject({ status: 404, body: { error: { code: 'ORG_NOT_FOUND' } } })
  })
})
