import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sf/commands.ts', () => ({ getAccessToken: vi.fn() }))
vi.mock('./sf/apiRequest.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./sf/apiRequest.ts')>()), apiRequest: vi.fn() }))

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
const invalidSession = () => new Response(JSON.stringify([{ errorCode: 'INVALID_SESSION_ID', message: 'Session expired or invalid' }]), { status: 401 })

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
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ authorization: 'Bearer 00D!token1' })
    expect(client.apiUsage).toEqual({ used: 10, max: 15000 })
  })

  it('refreshes the token once on 401, shared by concurrent requests', async () => {
    tokenMock.mockResolvedValueOnce('00D!old').mockResolvedValueOnce('00D!new')
    fetchMock.mockImplementation(async (_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      return headers.authorization === 'Bearer 00D!old' ? invalidSession() : ok()
    })
    const client = newClient()
    await Promise.all([client.request(get), client.request(get), client.request(get)])
    expect(tokenMock).toHaveBeenCalledTimes(2)
  })

  it('reports an auth error when the refreshed token is rejected too', async () => {
    fetchMock.mockImplementation(async () => invalidSession())
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

  it('answers a 401 that is not an invalid session, without sending the request again', async () => {
    fetchMock.mockResolvedValue(new Response('[{"errorCode":"CUSTOM"}]', { status: 401 }))
    const res = await newClient().requestRaw(post)
    expect(res.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("lets the request's content-type replace the default, whatever its case, and keeps the token last", async () => {
    fetchMock.mockResolvedValue(ok())
    await newClient().requestRaw({ ...post, headers: { 'Content-Type': 'text/csv', Authorization: 'Bearer stolen' } })
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['content-type']).toBe('text/csv')
    expect(headers).not.toHaveProperty('Content-Type')
    expect(headers.authorization).toBe('Bearer 00D!token1')
  })

  it('sends the checked path: an absolute URL of the instance becomes its path', async () => {
    fetchMock.mockResolvedValue(ok())
    await newClient().requestRaw({ ...get, path: 'https://acme.my.salesforce.com/services/data/v66.0/limits?x=1' })
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://acme.my.salesforce.com/services/data/v66.0/limits?x=1')
  })

  it('keeps the status of an answer whose body stops arriving', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('[{"id":'))
        controller.error(new Error('timed out'))
      },
    })
    fetchMock.mockResolvedValue(new Response(body, { status: 201 }))
    const res = await newClient().requestRaw(post, { maxBodyBytes: 1000 })
    expect(res).toMatchObject({ status: 201, body: '', incomplete: true })
  })

  it('stops reading a body longer than asked for', async () => {
    fetchMock.mockResolvedValue(new Response('x'.repeat(100), { status: 200 }))
    const res = await newClient().requestRaw(get, { maxBodyBytes: 10 })
    expect(res).toMatchObject({ body: '', truncated: true })
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
    expect(cliMock.mock.calls[0][1].headers).toMatchObject({ 'content-type': 'application/json' })
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
