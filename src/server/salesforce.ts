// Calls the Salesforce REST API for one org. See docs/design.md
// ("呼び出しの手順", "代わりの経路への切り替え").
//
// The usual transport is fetch with the access token from the sf CLI. The
// fallback transport is `sf api request rest`, which is slow (about 3 seconds
// per call) but needs no token.
import type { ApiUsage } from '../shared/api.ts'
import { log } from './log.ts'
import { apiRequest, type RawResponse } from './sf/apiRequest.ts'
import { getAccessToken } from './sf/commands.ts'
import { OrgAuthError, SfCliError, SfNotFoundError, isAuthErrorMessage } from './sf/errors.ts'

/** Salesforce answered with an HTTP error. `body` is its parsed JSON when possible. */
export class SalesforceError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(status: number, body: unknown) {
    super(salesforceMessage(status, body))
    this.name = 'SalesforceError'
    this.status = status
    this.body = body
  }
}

function salesforceMessage(status: number, body: unknown): string {
  if (Array.isArray(body) && body[0] && typeof body[0] === 'object' && 'message' in body[0]) {
    return String((body[0] as { message: unknown }).message)
  }
  return `Salesforce returned HTTP ${status}`
}

export type SalesforceRequest = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'HEAD'
  /** Path on the instance, starting with /services/. */
  path: string
  headers?: Record<string, string>
  body?: string
}

export type SalesforceResponse = {
  status: number
  headers: Record<string, string>
  /** Parsed JSON, or the raw text when the body is not JSON. */
  body: unknown
}

/** Salesforce did not answer in time. */
export class SalesforceTimeoutError extends Error {
  constructor() {
    super('Salesforce did not respond in time.')
    this.name = 'SalesforceTimeoutError'
  }
}

/**
 * The connection broke while a request that changes data was in flight.
 * Salesforce may have processed it, so it is not sent again.
 */
export class SalesforceUnreachableError extends Error {
  constructor() {
    super(
      'The connection to Salesforce broke while sending the request. Salesforce may already have processed it, so sfbench did not send it again. Check the result in Salesforce.',
    )
    this.name = 'SalesforceUnreachableError'
  }
}

/** The fetch transport failed before or while talking to Salesforce. */
class FetchFailure extends Error {
  /** False when the request was never sent (for example, no access token). */
  readonly mayHaveReachedSalesforce: boolean
  constructor(message: string, mayHaveReachedSalesforce: boolean) {
    super(message)
    this.name = 'FetchFailure'
    this.mayHaveReachedSalesforce = mayHaveReachedSalesforce
  }
}

type Transport = 'fetch' | 'cli'

const RETRY_FETCH_AFTER_MS = 10 * 60 * 1000

export type OrgClientOptions = {
  username: string
  instanceUrl: string
  tmpDir: string
  /** SFBENCH_TRANSPORT=cli: always use `sf api request rest` (for development). */
  forceCli: boolean
  /** How long to wait for Salesforce. Read on every request, so a settings change applies at once. */
  timeoutMs: () => number
}

export class OrgClient {
  readonly username: string
  readonly instanceUrl: string
  apiUsage: ApiUsage | undefined
  private readonly tmpDir: string
  private readonly forceCli: boolean
  private readonly timeoutMs: () => number
  private transport: Transport = 'fetch'
  private switchedToCliAt = 0
  private token: Promise<string> | undefined
  /** The value `token` resolved to, once it has. */
  private tokenValue: string | undefined
  /** The rejected token that the pending `token` run is replacing. */
  private replacing: string | undefined
  private apiVersion: Promise<string> | undefined

  constructor(options: OrgClientOptions) {
    this.username = options.username
    this.instanceUrl = options.instanceUrl
    this.tmpDir = options.tmpDir
    this.forceCli = options.forceCli
    this.timeoutMs = options.timeoutMs
  }

  /** The latest API version the org supports, such as "66.0". */
  version(): Promise<string> {
    this.apiVersion ??= this.request({ method: 'GET', path: '/services/data/' }).then((res) => {
      const versions = res.body as { version: string }[]
      return versions[versions.length - 1].version
    })
    this.apiVersion.catch(() => (this.apiVersion = undefined))
    return this.apiVersion
  }

  /** Sends a request. Throws SalesforceError for HTTP errors and OrgAuthError when the org needs a new login. */
  async request(req: SalesforceRequest): Promise<SalesforceResponse> {
    assertSalesforcePath(req.path, this.instanceUrl)
    const raw = await this.send(req)
    this.recordApiUsage(raw.headers['sforce-limit-info'])
    const body = parseBody(raw.body)
    if (raw.status >= 400) throw new SalesforceError(raw.status, body)
    return { status: raw.status, headers: raw.headers, body }
  }

  private async send(req: SalesforceRequest): Promise<RawResponse> {
    if (this.forceCli) return this.sendWithCli(req)
    const readOnly = req.method === 'GET' || req.method === 'HEAD'
    // After switching to sf, fetch is tried again after a while, but only with
    // a read-only request: a request that changes data must not be the one
    // that discovers fetch still fails, because it could not be sent again.
    if (this.transport === 'cli' && (!readOnly || Date.now() - this.switchedToCliAt < RETRY_FETCH_AFTER_MS)) {
      return this.sendWithCli(req)
    }
    try {
      const res = await this.sendWithFetch(req)
      this.transport = 'fetch'
      return res
    } catch (e) {
      if (!(e instanceof FetchFailure)) throw e
      // A request that changes data is sent again only if nothing reached
      // Salesforce yet (the token could not be obtained). After a network
      // error, Salesforce may already have processed it.
      if (e.mayHaveReachedSalesforce && !readOnly) throw new SalesforceUnreachableError()
      // Switch only if sf succeeds: when the network is down, sf fails too.
      log.warn(`${this.username}: ${e.message}; trying sf api request rest`)
      const res = await this.sendWithCli(req)
      if (this.transport !== 'cli') log.info(`${this.username}: switched to sf api request rest`)
      this.transport = 'cli'
      this.switchedToCliAt = Date.now()
      return res
    }
  }

  private async sendWithFetch(req: SalesforceRequest): Promise<RawResponse> {
    let token = await this.getTokenForFetch()
    let res = await this.fetchOnce(req, token)
    if (res.status === 401) {
      // The access token expired. sf refreshes it; if the refresh token is no
      // longer valid, sf returns the same stale token and the retry fails too.
      token = await this.getTokenForFetch(token)
      res = await this.fetchOnce(req, token)
      if (res.status === 401) {
        this.token = undefined
        throw new OrgAuthError(this.username, 'Salesforce rejected the session (401).')
      }
    }
    return res
  }

  private async getTokenForFetch(stale?: string): Promise<string> {
    try {
      return await this.getToken(stale)
    } catch (e) {
      if (e instanceof OrgAuthError || e instanceof SfNotFoundError) throw e
      if (e instanceof SfCliError && isAuthErrorMessage(e.message)) throw new OrgAuthError(this.username, e.message)
      throw new FetchFailure(`could not get an access token (${(e as Error).message})`, false)
    }
  }

  private sendWithCli(req: SalesforceRequest): Promise<RawResponse> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...req.headers,
    }
    return apiRequest(
      this.username,
      { method: req.method, path: req.path, headers, body: req.body },
      this.tmpDir,
      this.timeoutMs(),
    )
  }

  /**
   * The access token. Concurrent callers share one `sf org auth
   * show-access-token` run. `stale` is the token Salesforce just rejected: a
   * new one is fetched only if no other caller has already replaced it.
   */
  private getToken(stale?: string): Promise<string> {
    // All checks are synchronous, so that concurrent callers see each other's run.
    if (this.token) {
      if (stale === undefined) return this.token
      const alreadyReplaced = this.tokenValue !== undefined && this.tokenValue !== stale
      if (stale === this.replacing || alreadyReplaced) return this.token
    }
    const pending = getAccessToken(this.username, this.tmpDir)
    this.token = pending
    this.tokenValue = undefined
    this.replacing = stale
    pending.then(
      (value) => {
        if (this.token === pending) {
          this.tokenValue = value
          this.replacing = undefined
        }
      },
      () => {
        if (this.token === pending) {
          this.token = undefined
          this.replacing = undefined
        }
      },
    )
    return pending
  }

  private async fetchOnce(req: SalesforceRequest, token: string): Promise<RawResponse> {
    try {
      const res = await fetch(new URL(req.path, this.instanceUrl), {
        method: req.method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...req.headers,
        },
        body: req.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs()),
      })
      const headers: Record<string, string> = {}
      res.headers.forEach((value, key) => (headers[key] = value))
      return { status: res.status, headers, body: await res.text() }
    } catch (e) {
      if ((e as Error).name === 'TimeoutError') throw new SalesforceTimeoutError()
      throw new FetchFailure(`fetch failed (${(e as Error).message})`, true)
    }
  }

  private recordApiUsage(header: string | undefined): void {
    const m = header ? /api-usage=(\d+)\/(\d+)/.exec(header) : null
    if (m) this.apiUsage = { used: Number(m[1]), max: Number(m[2]) }
  }
}

function parseBody(text: string): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * Only paths under /services/ on the org's own instance may be requested, so
 * that the server can never be used to send the token anywhere else.
 */
export function assertSalesforcePath(path: string, instanceUrl: string): void {
  let url: URL
  try {
    url = new URL(path, instanceUrl)
  } catch {
    throw new InvalidPathError(path)
  }
  if (url.origin !== new URL(instanceUrl).origin || !url.pathname.startsWith('/services/')) {
    throw new InvalidPathError(path)
  }
}

export class InvalidPathError extends Error {
  constructor(path: string) {
    super(`Only paths under /services/ on the org's instance are allowed: ${path}`)
    this.name = 'InvalidPathError'
  }
}
