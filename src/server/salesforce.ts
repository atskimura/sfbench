// Calls the Salesforce REST API for one org. See docs/design.md
// ("呼び出しの手順", "代わりの経路への切り替え").
//
// The usual transport is fetch with the access token from the sf CLI. The
// fallback transport is `sf api request rest`, which is slow (about 3 seconds
// per call) but needs no token.
import { isServicesPath, type ApiUsage } from '../shared/api.ts'
import { log } from './log.ts'
import { apiRequest, isInvalidSession, type RawResponse } from './sf/apiRequest.ts'
import { getAccessToken } from './sf/commands.ts'
import { OrgAuthError, SfCliError, SfNotFoundError, SfTimeoutError, isAuthErrorMessage } from './sf/errors.ts'

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
  /**
   * The request may change data although its method reads (such as the
   * Tooling API's executeAnonymous, a GET that runs Apex). Such a request,
   * like any other method than GET and HEAD, is never sent twice.
   */
  changesData?: boolean
}

/** Whether a request may change data: decided here only (docs/design.md "経路の選択"). */
export function mayChangeData(req: Pick<SalesforceRequest, 'method' | 'changesData'>): boolean {
  return req.changesData === true || (req.method !== 'GET' && req.method !== 'HEAD')
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

/** The screen asked for an API version the org does not support: nothing was sent. */
export class UnsupportedVersionError extends Error {
  constructor(version: string) {
    super(`The org does not support API version ${version}.`)
    this.name = 'UnsupportedVersionError'
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
  private apiVersions: Promise<string[]> | undefined

  constructor(options: OrgClientOptions) {
    this.username = options.username
    this.instanceUrl = options.instanceUrl
    this.tmpDir = options.tmpDir
    this.forceCli = options.forceCli
    this.timeoutMs = options.timeoutMs
  }

  /**
   * The API versions the org supports, oldest first, such as "66.0" last. An
   * org can list a version twice (seen around a release), so each is kept once.
   */
  versions(): Promise<string[]> {
    this.apiVersions ??= this.request({ method: 'GET', path: '/services/data/' }).then((res) =>
      [...new Set((res.body as { version: string }[]).map((v) => v.version))].sort((a, b) => Number(a) - Number(b)),
    )
    this.apiVersions.catch(() => (this.apiVersions = undefined))
    return this.apiVersions
  }

  /**
   * The API version to use: `requested` if the org supports it, else the latest
   * when none is requested. A version the org does not support is refused
   * (UnsupportedVersionError), never replaced by another.
   */
  async version(requested?: string): Promise<string> {
    const versions = await this.versions()
    if (requested === undefined) return versions[versions.length - 1]
    if (!versions.includes(requested)) throw new UnsupportedVersionError(requested)
    return requested
  }

  /** Sends a request. Throws SalesforceError for HTTP errors and OrgAuthError when the org needs a new login. */
  async request(req: SalesforceRequest): Promise<SalesforceResponse> {
    const raw = await this.requestRaw(req)
    const body = parseBody(raw.body)
    if (raw.status >= 400) throw new SalesforceError(raw.status, body)
    return { status: raw.status, headers: raw.headers, body }
  }

  /**
   * Sends a request and returns what Salesforce answered, whatever its status
   * (the REST API screen shows a 4xx as a response, docs/rest.md). Throws
   * OrgAuthError only when Salesforce says the session is invalid even with a
   * new token. With `maxBodyBytes`, a longer body is cut off while it is read.
   */
  async requestRaw(req: SalesforceRequest, options: { maxBodyBytes?: number } = {}): Promise<RawResponse> {
    // What was checked is what is sent, on either transport.
    const checked = { ...req, path: salesforcePath(req.path, this.instanceUrl) }
    const raw = await this.send(checked, options.maxBodyBytes)
    this.recordApiUsage(raw.headers['sforce-limit-info'])
    return raw
  }

  private async send(req: SalesforceRequest, maxBodyBytes: number | undefined): Promise<RawResponse> {
    if (this.forceCli) return this.sendWithCli(req, maxBodyBytes)
    const readOnly = !mayChangeData(req)
    // After switching to sf, fetch is tried again after a while, but only with
    // a read-only request: a request that changes data must not be the one
    // that discovers fetch still fails, because it could not be sent again.
    if (this.transport === 'cli' && (!readOnly || Date.now() - this.switchedToCliAt < RETRY_FETCH_AFTER_MS)) {
      return this.sendWithCli(req, maxBodyBytes)
    }
    try {
      const res = await this.sendWithFetch(req, maxBodyBytes)
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
      const res = await this.sendWithCli(req, maxBodyBytes)
      if (this.transport !== 'cli') log.info(`${this.username}: switched to sf api request rest`)
      this.transport = 'cli'
      this.switchedToCliAt = Date.now()
      return res
    }
  }

  private async sendWithFetch(req: SalesforceRequest, maxBodyBytes: number | undefined): Promise<RawResponse> {
    let token = await this.getTokenForFetch()
    let res = await this.fetchOnce(req, token, maxBodyBytes)
    // Only Salesforce saying the session is invalid sends the request again: any
    // other 401 (such as one from the user's Apex REST, which may have changed
    // data first) is the answer (docs/rest.md "Salesforce が返した 4xx と 5xx").
    if (isInvalidSession(res)) {
      // The access token expired. sf refreshes it; if the refresh token is no
      // longer valid, sf returns the same stale token and the retry fails too.
      token = await this.getTokenForFetch(token)
      res = await this.fetchOnce(req, token, maxBodyBytes)
      if (isInvalidSession(res)) {
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

  private async sendWithCli(req: SalesforceRequest, maxBodyBytes: number | undefined): Promise<RawResponse> {
    try {
      const res = await apiRequest(this.username, { method: req.method, path: req.path, headers: requestHeaders(req), body: req.body }, this.tmpDir, this.timeoutMs())
      return maxBodyBytes !== undefined ? cutBody(res, maxBodyBytes) : res
    } catch (e) {
      // The same answer as fetch's timeout: Salesforce may have processed the request.
      throw e instanceof SfTimeoutError ? new SalesforceTimeoutError() : e
    }
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

  private async fetchOnce(req: SalesforceRequest, token: string, maxBodyBytes: number | undefined): Promise<RawResponse> {
    try {
      const res = await fetch(new URL(req.path, this.instanceUrl), {
        method: req.method,
        // The token goes last, so that no header of the request can replace it.
        headers: { ...requestHeaders(req), authorization: `Bearer ${token}` },
        body: req.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs()),
      })
      const headers: Record<string, string> = {}
      res.headers.forEach((value, key) => (headers[key] = value))
      return { status: res.status, headers, ...(await readBody(res, maxBodyBytes)) }
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

/**
 * The headers to send: the defaults, then the request's own, all with names in
 * lower case, so that `content-type` from the request replaces the default
 * rather than adding a second value to it (docs/rest.md "要求").
 */
function requestHeaders(req: SalesforceRequest): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (req.body !== undefined) headers['content-type'] = 'application/json'
  for (const [name, value] of Object.entries(req.headers ?? {})) headers[name.toLowerCase()] = value
  return headers
}

/**
 * Reads the body, stopping once it is longer than `maxBodyBytes`. With a
 * limit (the REST API screen), a body that stops arriving still returns the
 * status, so that a processed request is not taken for one of unknown outcome.
 */
async function readBody(res: Response, maxBodyBytes: number | undefined): Promise<Pick<RawResponse, 'body' | 'size' | 'truncated' | 'incomplete'>> {
  if (maxBodyBytes === undefined || !res.body) {
    const body = await res.text()
    return { body, size: Buffer.byteLength(body) }
  }
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = res.body.getReader()
  for (;;) {
    let next: Awaited<ReturnType<typeof reader.read>>
    try {
      next = await reader.read()
    } catch {
      // Salesforce answered (the status is known) but the body stopped
      // arriving, such as when time ran out: the request was processed.
      return { body: '', size, incomplete: true }
    }
    const { done, value } = next
    if (done) break
    size += value.byteLength
    if (size > maxBodyBytes) {
      await reader.cancel()
      return { body: '', size, truncated: true }
    }
    chunks.push(value)
  }
  return { body: Buffer.concat(chunks).toString('utf8'), size }
}

function cutBody(res: RawResponse, maxBodyBytes: number): RawResponse {
  const size = Buffer.byteLength(res.body)
  return size > maxBodyBytes ? { ...res, body: '', size, truncated: true } : { ...res, size }
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
 * The path to send, as checked: only paths under /services/ on the org's own
 * instance may be requested, so that the server can never be used to send the
 * token anywhere else. An absolute URL of the instance becomes its path.
 */
export function salesforcePath(path: string, instanceUrl: string): string {
  let url: URL
  try {
    url = new URL(path, instanceUrl)
  } catch {
    throw new InvalidPathError(path)
  }
  if (url.origin !== new URL(instanceUrl).origin || !isServicesPath(url.pathname)) {
    throw new InvalidPathError(path)
  }
  return url.pathname + url.search
}

export class InvalidPathError extends Error {
  constructor(path: string) {
    super(`Only paths under /services/ on the org's instance are allowed: ${path}`)
    this.name = 'InvalidPathError'
  }
}
