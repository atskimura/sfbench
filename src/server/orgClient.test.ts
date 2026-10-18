import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sf/commands.ts', () => ({ getAccessToken: vi.fn() }))
vi.mock('./sf/apiRequest.ts', () => ({ apiRequest: vi.fn() }))

const { getAccessToken } = await import('./sf/commands.ts')
const { apiRequest } = await import('./sf/apiRequest.ts')
const { OrgClient, SalesforceTimeoutError, SalesforceUnreachableError } = await import('./salesforce.ts')
const { OrgAuthError, SfCliError, SfTimeoutError } = await import('./sf/errors.ts')

const tokenMock = vi.mocked(getAccessToken)
const cliMock = vi.mocked(apiRequest)
const fetchMock = vi.fn<typeof fetch>()

const ok = (body: unknown = { ok: true }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'sforce-limit-info': 'api-usage=10/15000' } })
const cliOk = { status: 200, headers: {}, body: '{"via":"cli"}' }
const networkError = () => Promise.reject(new TypeError('fetch failed'))

const newClient = () =>
  new OrgClient({
    username: 'u@example.com',
    instanceUrl: 'https://acme.my.salesforce.com',
    tmpDir: '/tmp',
    forceCli: false,
    timeoutMs: () => 120_000,
  })
const get = { method: 'GET', path: '/services/data/v66.0/limits' } as const
const post = { method: 'POST', path: '/services/data/v66.0/sobjects/Account', body: '{"Name":"x"}' } as const

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  tokenMock.mockResolvedValue('00D!token1')
})
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('OrgClient', () => {
  it('calls Salesforce with the token from sf and records API usage', async () => {
    fetchMock.mockResolvedValueOnce(ok())
    const client = newClient()
    expect((await client.request(get)).body).toEqual({ ok: true })
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer 00D!token1' })
    expect(client.apiUsage).toEqual({ used: 10, max: 15000 })
  })

  it('refreshes the token once on 401, shared by concurrent requests', async () => {
    tokenMock.mockResolvedValueOnce('00D!old').mockResolvedValueOnce('00D!new')
    fetchMock.mockImplementation(async (_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      return headers.Authorization === 'Bearer 00D!old' ? new Response('', { status: 401 }) : ok()
    })
    const client = newClient()
    await Promise.all([client.request(get), client.request(get), client.request(get)])
    expect(tokenMock).toHaveBeenCalledTimes(2)
  })

  it('reports an auth error when the refreshed token is rejected too', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 401 }))
    await expect(newClient().request(get)).rejects.toBeInstanceOf(OrgAuthError)
    expect(cliMock).not.toHaveBeenCalled()
  })

  it('reports an auth error, without trying sf, when sf says the refresh token expired', async () => {
    tokenMock.mockRejectedValue(new SfCliError('Unable to refresh session due to: expired access/refresh token'))
    await expect(newClient().request(get)).rejects.toBeInstanceOf(OrgAuthError)
    expect(cliMock).not.toHaveBeenCalled()
  })

  it('falls back to sf for a read after a network error and keeps using it', async () => {
    fetchMock.mockImplementation(networkError)
    cliMock.mockResolvedValue(cliOk)
    const client = newClient()
    expect((await client.request(get)).body).toEqual({ via: 'cli' })
    expect((await client.request(get)).body).toEqual({ via: 'cli' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not send a data-changing request again after a network error', async () => {
    fetchMock.mockImplementation(networkError)
    await expect(newClient().request(post)).rejects.toBeInstanceOf(SalesforceUnreachableError)
    expect(cliMock).not.toHaveBeenCalled()
  })

  it('reports a timeout of sf api request as a Salesforce timeout', async () => {
    fetchMock.mockImplementation(networkError)
    cliMock.mockRejectedValue(new SfTimeoutError('sf api request timed out'))
    await expect(newClient().request(get)).rejects.toBeInstanceOf(SalesforceTimeoutError)
  })

  it('does not send a GET marked as changing data again after a network error', async () => {
    fetchMock.mockImplementation(networkError)
    await expect(newClient().request({ ...get, changesData: true })).rejects.toBeInstanceOf(SalesforceUnreachableError)
    expect(cliMock).not.toHaveBeenCalled()
  })

  it('sends a data-changing request through sf when the token could not be obtained', async () => {
    tokenMock.mockRejectedValue(new SfCliError('sf did not return a usable access token'))
    cliMock.mockResolvedValue(cliOk)
    expect((await newClient().request(post)).body).toEqual({ via: 'cli' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(cliMock.mock.calls[0][1].headers).toMatchObject({ 'Content-Type': 'application/json' })
  })

  it('retries fetch after 10 minutes only with a read, not with a data-changing request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    fetchMock.mockImplementationOnce(networkError)
    cliMock.mockResolvedValue(cliOk)
    const client = newClient()
    await client.request(get) // switches to sf
    vi.setSystemTime(Date.now() + 11 * 60 * 1000)
    await client.request(post) // still sf
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockResolvedValueOnce(ok())
    expect((await client.request(get)).body).toEqual({ ok: true }) // back to fetch
  })

  it('rejects paths outside /services/ before sending anything', async () => {
    await expect(newClient().request({ method: 'GET', path: '/secur/frontdoor.jsp' })).rejects.toThrow('/services/')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
