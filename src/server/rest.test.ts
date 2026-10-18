// docs/rest.md "サーバーの `/rest`" and "`--rest` の起動時の指定".
import { describe, expect, it } from 'vitest'
import { checkRestRequest, restLaunch, restResponseBody, RestRequestError } from './rest.ts'

const path = '/services/data/v66.0/sobjects/Account'

describe('checkRestRequest', () => {
  it('accepts a request and puts header names in lower case', () => {
    expect(checkRestRequest({ method: 'POST', path, headers: { 'Content-Type': 'text/csv', 'Sforce-Auto-Assign': 'FALSE' }, body: 'Name\nA' })).toEqual({
      method: 'POST',
      path,
      headers: { 'content-type': 'text/csv', 'sforce-auto-assign': 'FALSE' },
      body: 'Name\nA',
    })
  })

  it('refuses a body on a method that has none', () => {
    expect(() => checkRestRequest({ method: 'GET', path, body: '{}' })).toThrow(RestRequestError)
    expect(() => checkRestRequest({ method: 'DELETE', path, body: '{}' })).toThrow(RestRequestError)
  })

  it('refuses headers that carry the token or the connection, whatever their case', () => {
    for (const name of ['Authorization', 'COOKIE', 'Host', 'Content-Length', 'Proxy-Authorization', 'Transfer-Encoding']) {
      expect(() => checkRestRequest({ method: 'GET', path, headers: { [name]: 'x' } }), name).toThrow(RestRequestError)
    }
  })

  it('refuses a header name or value that could split the request', () => {
    expect(() => checkRestRequest({ method: 'GET', path, headers: { 'X-A\r\nX-B': 'x' } })).toThrow(RestRequestError)
    expect(() => checkRestRequest({ method: 'GET', path, headers: { 'X-A': 'x\r\nAuthorization: y' } })).toThrow(RestRequestError)
  })

  it('takes an empty body for no body', () => {
    expect(checkRestRequest({ method: 'POST', path, body: '' }).body).toBeUndefined()
    expect(checkRestRequest({ method: 'GET', path, body: '' }).body).toBeUndefined()
  })

  it('refuses the same header twice in different case', () => {
    expect(() => checkRestRequest({ method: 'POST', path, headers: { 'Content-Type': 'text/csv', 'content-type': 'application/json' } })).toThrow(/twice/)
  })

  it('refuses other methods', () => {
    expect(() => checkRestRequest({ method: 'HEAD', path })).toThrow(RestRequestError)
  })
})

describe('restResponseBody', () => {
  it('passes the body and headers back without set-cookie', () => {
    expect(restResponseBody({ status: 400, headers: { 'content-type': 'application/json', 'set-cookie': 'sid=x' }, body: '[{}]' })).toEqual({
      headers: { 'content-type': 'application/json' },
      body: '[{}]',
      size: 4,
    })
  })

  it('leaves out a binary or cut-off body', () => {
    expect(restResponseBody({ status: 200, headers: { 'content-type': 'application/pdf' }, body: '%PDF' })).toMatchObject({ body: '', bodyOmitted: 'binary' })
    expect(restResponseBody({ status: 200, headers: {}, body: '', truncated: true, size: 30_000_000 })).toMatchObject({ bodyOmitted: 'tooLarge', size: 30_000_000 })
  })
})

describe('restLaunch', () => {
  it('takes GET by default and the method in any case', () => {
    expect(restLaunch({ path })).toEqual({ method: 'GET', path })
    expect(restLaunch({ path, method: 'post', body: '{"Name":"A"}' })).toEqual({ method: 'POST', path, body: '{"Name":"A"}' })
  })

  it('refuses a path outside /services/, a body that is not JSON, and a body on GET', () => {
    expect(() => restLaunch({ path: 'https://evil.example.com/services/x' })).toThrow(RestRequestError)
    expect(() => restLaunch({ path, method: 'POST', body: 'Name=A' })).toThrow(/JSON/)
    expect(() => restLaunch({ path, body: '{}' })).toThrow(/no body/)
  })
})
