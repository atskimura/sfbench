// docs/web.md "エラーの扱い": where each error is shown.
import { describe, expect, it } from 'vitest'
import { ApiRequestError } from './apiClient.ts'
import { errorKind, errorMessage, isLocatorGone, runFailure } from './errors.ts'
import { t } from './i18n/i18n.ts'

const api = (status: number, code: ApiRequestError['code'], extra: object = {}) =>
  new ApiRequestError(status, code, `server: ${code}`, { code: code as never, message: `server: ${code}`, ...extra })

describe('errors', () => {
  it('sorts the errors shown app-wide or by the org context', () => {
    expect(errorKind(new ApiRequestError(0, 'ABORTED', 'Aborted'))).toBe('aborted')
    expect(errorKind(new ApiRequestError(0, 'NETWORK_ERROR', 'down'))).toBe('sessionLost')
    expect(errorKind(api(401, 'UNAUTHORIZED'))).toBe('sessionLost')
    expect(errorKind(api(503, 'SF_CLI_NOT_FOUND'))).toBe('sfNotFound')
    expect(errorKind(api(409, 'ORG_AUTH_ERROR'))).toBe('orgAuth')
    expect(errorKind(api(404, 'ORG_NOT_FOUND'))).toBe('orgNotFound')
  })

  it('does not take an unknown path for a missing org', () => {
    expect(errorKind(api(404, 'NOT_FOUND'))).toBe('other')
  })

  it('offers a fix only for a query Salesforce refused, not for a timeout or a broken connection', () => {
    expect(runFailure(api(502, 'SALESFORCE_ERROR', { status: 503 }))).toMatchObject({ rejected: false })
    expect(runFailure(api(403, 'SALESFORCE_ERROR', { status: 403, details: [{ errorCode: 'REQUEST_LIMIT_EXCEEDED' }] }))).toMatchObject({ rejected: false })
    expect(runFailure(api(400, 'SALESFORCE_ERROR', { status: 400, details: [{ errorCode: 'INVALID_FIELD' }] }))).toEqual({
      message: 'server: SALESFORCE_ERROR',
      details: [{ errorCode: 'INVALID_FIELD' }],
      orgAuth: false,
      rejected: true,
    })
    expect(runFailure(api(504, 'SALESFORCE_TIMEOUT'))).toMatchObject({ message: t.salesforceTimeout, rejected: false })
    expect(runFailure(api(502, 'SALESFORCE_UNREACHABLE'))).toMatchObject({ message: t.salesforceUnreachable, rejected: false })
  })

  it('shows a login error in the result area with the command, and leaves the rest to other places', () => {
    expect(runFailure(api(409, 'ORG_AUTH_ERROR', { reloginCommand: 'sf org login web' }))).toEqual({
      message: t.orgAuthError,
      reloginCommand: 'sf org login web',
      orgAuth: true,
      rejected: false,
    })
    expect(runFailure(new ApiRequestError(0, 'NETWORK_ERROR', 'down'))).toBeUndefined()
    expect(runFailure(api(404, 'ORG_NOT_FOUND'))).toBeUndefined()
  })

  it('tells an expired query locator from other refusals', () => {
    expect(isLocatorGone(api(400, 'SALESFORCE_ERROR', { status: 400, details: [{ errorCode: 'INVALID_QUERY_LOCATOR' }] }))).toBe(true)
    expect(isLocatorGone(api(400, 'SALESFORCE_ERROR', { status: 400, details: [{ errorCode: 'INVALID_FIELD' }] }))).toBe(false)
  })

  it('shows the message of an error that is not from the API', () => {
    expect(errorMessage(new TypeError('x is undefined'))).toBe('x is undefined')
  })
})
