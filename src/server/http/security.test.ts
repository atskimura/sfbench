import { describe, expect, it } from 'vitest'
import { isAdminRequestOrigin, isAllowedHost, isSameOriginRequest } from './security.ts'

describe('isAllowedHost', () => {
  it('accepts 127.0.0.1 and localhost on the server port', () => {
    expect(isAllowedHost('127.0.0.1:7717', 7717, false)).toBe(true)
    expect(isAllowedHost('localhost:7717', 7717, false)).toBe(true)
  })

  it('rejects other hosts, ports and a missing Host', () => {
    expect(isAllowedHost('evil.example.com:7717', 7717, false)).toBe(false)
    expect(isAllowedHost('127.0.0.1:8000', 7717, false)).toBe(false)
    expect(isAllowedHost(undefined, 7717, false)).toBe(false)
  })

  it('accepts the Vite dev server only in dev mode', () => {
    expect(isAllowedHost('localhost:5173', 17717, false)).toBe(false)
    expect(isAllowedHost('localhost:5173', 17717, true)).toBe(true)
    expect(isAllowedHost('127.0.0.1:5173', 17717, true)).toBe(false)
  })
})

describe('isAdminRequestOrigin', () => {
  it('accepts requests without Origin (Node fetch) and rejects requests from web pages', () => {
    expect(isAdminRequestOrigin({ host: '127.0.0.1:7717' })).toBe(true)
    expect(isAdminRequestOrigin({ host: '127.0.0.1:7717', origin: 'http://127.0.0.1:7717' })).toBe(false)
    expect(isAdminRequestOrigin({ host: '127.0.0.1:7717', origin: 'null' })).toBe(false)
  })
})

describe('isSameOriginRequest', () => {
  it('accepts a same-origin GET without Origin', () => {
    expect(isSameOriginRequest({ host: '127.0.0.1:7717', 'sec-fetch-site': 'same-origin' })).toBe(true)
    expect(isSameOriginRequest({ host: '127.0.0.1:7717' })).toBe(true)
  })

  it('accepts a same-origin POST', () => {
    expect(isSameOriginRequest({ host: 'localhost:7717', origin: 'http://localhost:7717' })).toBe(true)
  })

  it('rejects a different Origin, including the other loopback name', () => {
    expect(isSameOriginRequest({ host: '127.0.0.1:7717', origin: 'http://evil.example.com' })).toBe(false)
    expect(isSameOriginRequest({ host: '127.0.0.1:7717', origin: 'http://localhost:7717' })).toBe(false)
  })

  it('rejects cross-site fetch metadata', () => {
    expect(isSameOriginRequest({ host: '127.0.0.1:7717', 'sec-fetch-site': 'cross-site' })).toBe(false)
    expect(isSameOriginRequest({ host: '127.0.0.1:7717', 'sec-fetch-site': 'same-site' })).toBe(false)
  })
})
