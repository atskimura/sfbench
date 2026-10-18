// The request file given to `sf api request rest` (docs/rest.md "送り方").
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./run.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./run.ts')>()), runSf: vi.fn() }))

const { runSf } = await import('./run.ts')
const { apiRequest, NotJsonBodyError } = await import('./apiRequest.ts')
const { OrgAuthError } = await import('./errors.ts')
const runMock = vi.mocked(runSf)

let dir: string
let sent: { body: { mode: string; raw?: unknown } } | undefined
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sfbench-test-'))
  runMock.mockImplementation(async (args) => {
    sent = JSON.parse(readFileSync(join(dir, args[4]), 'utf8'))
    return { stdout: 'HTTP/2 200\ncontent-type: application/json\n{"ok":true}', stderr: '', exitCode: 0 }
  })
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.resetAllMocks()
})

describe('apiRequest', () => {
  it('gives sf the JSON body parsed, since sf sends JSON.stringify of it', async () => {
    await apiRequest('u@example.com', { method: 'POST', path: '/services/data/v66.0/sobjects/Account', headers: {}, body: '{"Name":"A"}' }, dir, 1000)
    expect(sent?.body).toEqual({ mode: 'raw', raw: { Name: 'A' } })
  })

  it('refuses a number sf would round, and sends ordinary numbers', async () => {
    await expect(
      apiRequest('u@example.com', { method: 'POST', path: '/services/data/v66.0/sobjects/Account', headers: {}, body: '{"Amount__c":123456789012345678}' }, dir, 1000),
    ).rejects.toThrow(/15 digits/)
    expect(runMock).not.toHaveBeenCalled()
    await apiRequest('u@example.com', { method: 'POST', path: '/services/data/v66.0/sobjects/Account', headers: {}, body: '{"A":1.50,"B":-0.001,"C":123456789012345,"D":1e21}' }, dir, 1000)
    expect(sent?.body.raw).toEqual({ A: 1.5, B: -0.001, C: 123456789012345, D: 1e21 })
  })

  it('leaves the body out when there is none', async () => {
    await apiRequest('u@example.com', { method: 'DELETE', path: '/services/data/v66.0/sobjects/Account/001', headers: {} }, dir, 1000)
    expect(sent?.body.raw).toBeUndefined()
  })

  it('refuses a body that is not JSON, before running sf', async () => {
    await expect(
      apiRequest('u@example.com', { method: 'PUT', path: '/services/data/v66.0/jobs/ingest/750/batches', headers: {}, body: 'Name\nA' }, dir, 1000),
    ).rejects.toBeInstanceOf(NotJsonBodyError)
    expect(runMock).not.toHaveBeenCalled()
  })

  it('takes only an invalid session for a lost login, and returns any other 401', async () => {
    runMock.mockResolvedValueOnce({ stdout: 'HTTP/2 401\n[{"errorCode":"INVALID_SESSION_ID"}]', stderr: '', exitCode: 1 })
    await expect(apiRequest('u@example.com', { method: 'GET', path: '/services/data/', headers: {} }, dir, 1000)).rejects.toBeInstanceOf(OrgAuthError)
    runMock.mockResolvedValueOnce({ stdout: 'HTTP/2 401\n<Errors><Error><errorCode>INVALID_SESSION_ID</errorCode></Error></Errors>', stderr: '', exitCode: 1 })
    await expect(apiRequest('u@example.com', { method: 'GET', path: '/services/data/', headers: {} }, dir, 1000)).rejects.toBeInstanceOf(OrgAuthError)
    runMock.mockResolvedValueOnce({ stdout: 'HTTP/2 401\n[{"errorCode":"CUSTOM"}]', stderr: '', exitCode: 1 })
    expect((await apiRequest('u@example.com', { method: 'GET', path: '/services/apexrest/x', headers: {} }, dir, 1000)).status).toBe(401)
  })
})
