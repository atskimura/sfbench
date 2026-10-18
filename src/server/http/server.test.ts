import { describe, expect, it } from 'vitest'
import { SalesforceError, SalesforceTimeoutError, SalesforceUnreachableError } from '../salesforce.ts'
import { apexOutcomeOf, cacheControl, errorResponse, exceptionTypeOf, restOutcomeOf, unknownOrg, versionOf } from './server.ts'
import { ApexFileError, ApexRunError } from '../sf/apexRun.ts'
import { OrgAuthError, SfCliError, SfNotFoundError, SfTimeoutError } from '../sf/errors.ts'
import { RestRequestError } from '../rest.ts'

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

// docs/rest.md "置き場所と書き方"
describe('restOutcomeOf', () => {
  it('removes the record of a request Salesforce never ran, and marks the rest unknown', () => {
    expect(restOutcomeOf(new OrgAuthError('u@example.com', 'expired'))).toBeUndefined()
    expect(restOutcomeOf(new SalesforceTimeoutError())).toEqual({ state: 'unknown', reason: 'timeout' })
    expect(restOutcomeOf(new SalesforceUnreachableError())).toEqual({ state: 'unknown', reason: 'unreachable' })
    expect(restOutcomeOf(new SfCliError('sf failed'))).toEqual({ state: 'unknown', reason: 'error' })
  })

  it('answers a refused REST request with 400', () => {
    expect(errorResponse(new RestRequestError('no'))).toMatchObject({ status: 400, body: { error: { code: 'BAD_REQUEST' } } })
  })
})

// docs/apex.md "実行履歴", "実行の経路"
describe('Apex outcomes', () => {
  it('removes the record of a run that never happened, and marks the rest unknown', () => {
    expect(apexOutcomeOf(new OrgAuthError('u@example.com', 'expired'))).toBeUndefined()
    expect(apexOutcomeOf(new SfNotFoundError())).toBeUndefined()
    expect(apexOutcomeOf(new ApexFileError('ENOSPC'))).toBeUndefined()
    expect(apexOutcomeOf(new SfTimeoutError('sf apex run timed out'))).toEqual({ state: 'unknown', reason: 'timeout' })
    expect(apexOutcomeOf(new ApexRunError('unexpectedExecuteCommandError', 'x'))).toEqual({ state: 'unknown', reason: 'error' })
  })

  it('keeps only the type of an exception', () => {
    expect(exceptionTypeOf('System.DmlException: Insert failed. duplicate value found: 001xx')).toEqual({ exceptionType: 'System.DmlException' })
    expect(exceptionTypeOf('Something broke with record 001xx and no colon')).toEqual({})
    expect(exceptionTypeOf(undefined)).toEqual({})
  })

  it('answers an unknown sf failure with its message for the screen', () => {
    expect(errorResponse(new ApexRunError('unexpectedExecuteCommandError', 'socket hang up'))).toMatchObject({ status: 502, body: { error: { code: 'SF_CLI_ERROR', message: 'socket hang up' } } })
    expect(errorResponse(new ApexFileError('ENOSPC'))).toMatchObject({ status: 500, body: { error: { code: 'NOT_RUN' } } })
  })
})

describe('versionOf', () => {
  it('takes a version shaped as Salesforce writes it, and nothing else', () => {
    expect(versionOf(undefined)).toBeUndefined()
    expect(versionOf('66.0')).toBe('66.0')
    for (const bad of ['66', 'v66.0', '66.0 --json', 66, '']) expect(() => versionOf(bad)).toThrow('apiVersion')
  })
})
