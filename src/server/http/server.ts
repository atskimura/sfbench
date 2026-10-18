// The local HTTP server: the web UI's static files and the /api endpoints.
// See docs/design.md ("ローカルサーバー").
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, relative, sep } from 'node:path'
import {
  isValidTimeout,
  MAX_TIMEOUT_SECONDS,
  MIN_TIMEOUT_SECONDS,
  type AiTaskRequest,
  type AiTestRequest,
  type ApiError,
  type ApiErrorCode,
  type HistoryResponse,
  type LaunchOptions,
  type NextPageRequest,
  type OrgsResponse,
  type QueryRequest,
  type RestHistoryResponse,
  type RestOutcome,
  type RestResponse,
  type SessionResponse,
  type SettingsUpdate,
} from '../../shared/api.ts'
import { log } from '../log.ts'
import type { OrgRegistry } from '../orgs.ts'
import type { Paths } from '../paths.ts'
import {
  InvalidPathError,
  OrgClient,
  SalesforceError,
  SalesforceTimeoutError,
  SalesforceUnreachableError,
  salesforcePath,
} from '../salesforce.ts'
import { checkRestRequest, MAX_REST_RESPONSE_BYTES, restLaunch, restResponseBody, RestRequestError } from '../rest.ts'
import { NotJsonBodyError } from '../sf/apiRequest.ts'
import { openOrg, reloginCommand } from '../sf/commands.ts'
import { OrgAuthError, SfCliError, SfNotFoundError } from '../sf/errors.ts'
import { AiError } from '../ai/errors.ts'
import { generate, TEST_REQUEST } from '../ai/generate.ts'
import { invalidTaskRequest } from '../ai/tasks.ts'
import { addHistory, addRestPending, AiSettingsError, finishRest, loadHistory, loadRestHistory, mergeAiSettings, settingsView, type SettingsStore } from '../store.ts'
import { isAdminRequestOrigin, isAllowedHost, isSameOriginRequest } from './security.ts'

const MAX_BODY_BYTES = 5 * 1024 * 1024
/** The web UI keeps what it sends to the AI within 100 KB; this is the last guard (docs/ai.md "送る量"). */
const MAX_AI_INPUT_BYTES = 200 * 1024
const LAUNCH_CODE_TTL_MS = 60_000
const LAUNCH_CODE_TTL_NO_OPEN_MS = 10 * 60_000
export const DEV_LAUNCH_CODE = 'dev'

export type AppOptions = {
  version: string
  dev: boolean
  port: number
  adminToken: string
  paths: Paths
  orgs: OrgRegistry
  /** Built web UI, or undefined when it is not built (development). */
  webRoot: string | undefined
  settings: SettingsStore
  /** In dev mode, a session token that survives restarts. */
  devSessionToken?: string
  onShutdown: () => void
}

class HttpError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

type PendingLaunch = { launch: LaunchOptions; expiresAt: number }

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
}

/**
 * Only the files under /assets/ have a hash in their names, so only they keep
 * their content for good. The page, the favicon and licenses.txt change with
 * the version under the same name.
 */
export function cacheControl(pathname: string): string {
  return pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store'
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin',
}

/**
 * Static files are read into memory at startup: the server runs from npx's
 * cache, which can be replaced while the server is running.
 */
function loadStaticFiles(root: string | undefined): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  if (!root || !existsSync(root)) return files
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else files.set(`/${relative(root, full).split(sep).join('/')}`, readFileSync(full))
    }
  }
  walk(root)
  return files
}

export class App {
  /** The port the server listens on; checked against the Host header. */
  port: number
  private readonly options: AppOptions
  private readonly staticFiles: Map<string, Buffer>
  private readonly sessions = new Set<string>()
  private readonly launches = new Map<string, PendingLaunch>()
  /** This run of the server: a REST request still pending from another run was cut off (docs/rest.md "実行履歴"). */
  private readonly bootId = randomUUID()

  constructor(options: AppOptions) {
    this.options = options
    this.port = options.port
    this.staticFiles = loadStaticFiles(options.webRoot)
    if (options.devSessionToken) this.sessions.add(options.devSessionToken)
  }

  createServer(): Server {
    return createServer((req, res) => {
      this.handle(req, res).catch((e: unknown) => {
        log.error(`unhandled error: ${(e as Error).stack ?? String(e)}`)
        if (!res.headersSent) sendJson(res, 500, errorBody('INTERNAL_ERROR', 'Internal error'))
        else res.end()
      })
    })
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isAllowedHost(req.headers.host, this.port, this.options.dev)) {
      sendJson(res, 421, errorBody('BAD_REQUEST', 'Unexpected Host header'))
      return
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    try {
      if (url.pathname.startsWith('/api/')) await this.handleApi(req, res, url)
      else this.serveStatic(req, res, url.pathname)
    } catch (e) {
      await this.sendError(res, e)
    }
  }

  // ---- API ----

  private async handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const path = url.pathname
    const method = req.method ?? 'GET'

    // Admin endpoints, called by the CLI entry point.
    if (path === '/api/health' || path === '/api/launch' || path === '/api/shutdown') {
      this.requireAdmin(req)
      if (path === '/api/health' && method === 'GET') {
        sendJson(res, 200, { version: this.options.version, pid: process.pid })
        return
      }
      if (path === '/api/launch' && method === 'POST') {
        sendJson(res, 200, this.createLaunch(await readJsonObject(req)))
        return
      }
      if (path === '/api/shutdown' && method === 'POST') {
        sendJson(res, 200, { ok: true })
        setImmediate(this.options.onShutdown)
        return
      }
      throw new HttpError(405, 'BAD_REQUEST', 'Method not allowed')
    }

    if (!isSameOriginRequest(req.headers)) throw new HttpError(403, 'UNAUTHORIZED', 'Cross-origin request')

    if (path === '/api/session' && method === 'POST') {
      sendJson(res, 200, this.exchangeCode(await readJsonObject(req)))
      return
    }

    const session = req.headers['x-sfbench-session']
    if (typeof session !== 'string' || !this.sessions.has(session)) {
      throw new HttpError(401, 'UNAUTHORIZED', 'No valid session. Run `npx sfbench` to open sfbench again.')
    }

    if (path === '/api/settings') {
      if (method === 'GET') {
        sendJson(res, 200, settingsView(this.options.settings.get()))
        return
      }
      if (method === 'PUT') {
        const body = (await readJsonObject(req)) as SettingsUpdate
        const settings = { ...this.options.settings.get() }
        if (typeof body.omitNamespace === 'boolean') settings.omitNamespace = body.omitNamespace
        if (body.requestTimeoutSeconds !== undefined) {
          if (!isValidTimeout(body.requestTimeoutSeconds)) {
            throw new HttpError(
              400,
              'BAD_REQUEST',
              `requestTimeoutSeconds must be an integer from ${MIN_TIMEOUT_SECONDS} to ${MAX_TIMEOUT_SECONDS}`,
            )
          }
          settings.requestTimeoutSeconds = body.requestTimeoutSeconds
        }
        // Without ai, the saved AI settings stay as they are (docs/ai.md "API").
        if (body.ai !== undefined) settings.ai = mergeAiSettings(settings.ai, body.ai)
        sendJson(res, 200, settingsView(this.options.settings.set(settings)))
        return
      }
    }

    if (path === '/api/ai/generate' && method === 'POST') {
      const body = await readJsonObject(req, { bytes: MAX_AI_INPUT_BYTES, code: 'PAYLOAD_TOO_LARGE', message: 'Too much to send to the AI.' })
      const invalid = invalidTaskRequest(body)
      if (invalid) throw new HttpError(400, 'BAD_REQUEST', invalid)
      await this.runAi(res, (signal) => generate(this.options.settings.get().ai, body as AiTaskRequest, signal).then((output) => ({ output })))
      return
    }

    if (path === '/api/ai/test' && method === 'POST') {
      const body = (await readJsonObject(req)) as Partial<AiTestRequest>
      // The settings being edited, with the saved key when none is typed (same rule as saving).
      const ai = mergeAiSettings(this.options.settings.get().ai, body.ai)
      const started = Date.now()
      await this.runAi(res, (signal) => generate(ai, TEST_REQUEST, signal).then(() => ({ elapsedMs: Date.now() - started })))
      return
    }

    if (path === '/api/orgs' && method === 'GET') {
      // waitForCheck=1: answer when the background connection check has finished.
      if (url.searchParams.get('waitForCheck') === '1') await this.options.orgs.waitForCheck()
      const body = await this.options.orgs.listWithAvailability(url.searchParams.get('refresh') === '1')
      sendJson(res, 200, body satisfies OrgsResponse)
      return
    }

    if (path === '/api/orgs/check' && method === 'POST') {
      await this.options.orgs.list(true)
      await this.options.orgs.checkConnections()
      sendJson(res, 200, (await this.options.orgs.listWithAvailability()) satisfies OrgsResponse)
      return
    }

    const m = /^\/api\/orgs\/([^/]+)\/(.+)$/.exec(path)
    if (m) {
      let username: string
      try {
        username = decodeURIComponent(m[1])
      } catch {
        throw new HttpError(400, 'BAD_REQUEST', 'Invalid org in the path')
      }
      await this.handleOrgApi(req, res, url, username, m[2], method)
      return
    }
    throw new HttpError(404, 'NOT_FOUND', 'Not found')
  }

  private async handleOrgApi(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    username: string,
    rest: string,
    method: string,
  ): Promise<void> {
    const client = await this.options.orgs.client(username)
    if (!client) throw unknownOrg(username)
    const refresh = url.searchParams.get('refresh') === '1'
    const withUsage = <T extends object>(body: T) => ({ ...body, apiUsage: client.apiUsage })

    if (rest === 'summary' && method === 'GET') {
      sendJson(res, 200, withUsage(await this.options.orgs.summary(client)))
      return
    }

    if (rest === 'history' && method === 'GET') {
      sendJson(res, 200, { entries: loadHistory(this.options.paths.historyDir, username) } satisfies HistoryResponse)
      return
    }

    if (rest === 'sobjects' && method === 'GET') {
      const tooling = url.searchParams.get('tooling') === '1'
      const described = await this.options.orgs.cachedDescribe(client, tooling ? 'tooling:global' : 'global', refresh, async () => {
        const version = await client.version()
        return (await client.request({ method: 'GET', path: `/services/data/v${version}/${tooling ? 'tooling/' : ''}sobjects/` })).body
      })
      sendJson(res, 200, withUsage({ ...(described.body as object), fetchedAt: described.fetchedAt }))
      return
    }

    const describe = /^sobjects\/([A-Za-z0-9_]+)$/.exec(rest)
    if (describe && method === 'GET') {
      const name = describe[1]
      const tooling = url.searchParams.get('tooling') === '1'
      const described = await this.options.orgs.cachedDescribe(client, `${tooling ? 'tooling:' : ''}${name}`, refresh, async () => {
        const version = await client.version()
        return (
          await client.request({
            method: 'GET',
            path: `/services/data/v${version}/${tooling ? 'tooling/' : ''}sobjects/${name}/describe/`,
          })
        ).body
      })
      sendJson(res, 200, withUsage({ ...(described.body as object), fetchedAt: described.fetchedAt }))
      return
    }

    if (rest === 'query' && method === 'POST') {
      const q = (await readJsonObject(req)) as Partial<QueryRequest>
      if (typeof q.soql !== 'string' || !q.soql.trim()) throw new HttpError(400, 'BAD_REQUEST', 'soql is required')
      const tooling = q.tooling === true
      const queryAll = q.queryAll === true
      if (tooling && queryAll) throw new HttpError(400, 'BAD_REQUEST', 'The Tooling API does not support Query All')
      const version = await client.version()
      const endpoint = tooling ? 'tooling/query' : queryAll ? 'queryAll' : 'query'
      const result = await client.request({
        method: 'GET',
        path: `/services/data/v${version}/${endpoint}?q=${encodeURIComponent(q.soql)}`,
        headers: await this.queryHeaders(client),
      })
      addHistory(this.options.paths.historyDir, username, {
        soql: q.soql,
        tooling,
        queryAll,
        executedAt: new Date().toISOString(),
        ...(typeof q.prompt === 'string' && q.prompt.trim() ? { prompt: q.prompt.trim().slice(0, 2000) } : {}),
      })
      sendJson(res, 200, withUsage(result.body as object))
      return
    }

    if (rest === 'query/next' && method === 'POST') {
      const q = (await readJsonObject(req)) as Partial<NextPageRequest>
      if (typeof q.nextRecordsUrl !== 'string') throw new HttpError(400, 'BAD_REQUEST', 'nextRecordsUrl is required')
      const result = await client.request({ method: 'GET', path: q.nextRecordsUrl, headers: await this.queryHeaders(client) })
      sendJson(res, 200, withUsage(result.body as object))
      return
    }

    if (rest === 'rest' && method === 'POST') {
      await this.sendRest(req, res, client)
      return
    }

    if (rest === 'rest/history' && method === 'GET') {
      sendJson(res, 200, { entries: loadRestHistory(this.options.paths.restHistoryDir, username, this.bootId) } satisfies RestHistoryResponse)
      return
    }

    if (rest === 'open' && method === 'POST') {
      await openOrg(username, this.options.paths.tmpDir)
      sendJson(res, 200, { ok: true })
      return
    }

    throw new HttpError(404, 'NOT_FOUND', 'Not found')
  }

  /**
   * Sends a request from the REST API screen (docs/rest.md "サーバーの `/rest`").
   * It is recorded as pending just before it is sent and updated when it ends,
   * so that what was sent can be told even if the screen goes away meanwhile.
   * The screen going away does not stop it.
   */
  private async sendRest(req: IncomingMessage, res: ServerResponse, client: OrgClient): Promise<void> {
    const request = checkRestRequest(await readJsonObject(req))
    // A path refused here was never sent, so it is checked before it is recorded.
    const pathname = new URL(salesforcePath(request.path, client.instanceUrl), client.instanceUrl).pathname
    const dir = this.options.paths.restHistoryDir
    const record = (write: () => void) => {
      try {
        write()
      } catch (e) {
        log.warn(`${client.username}: could not write the REST history (${(e as Error).message})`)
      }
    }
    let id: string | undefined
    record(() => (id = addRestPending(dir, client.username, request, this.bootId)))
    const started = performance.now()
    try {
      // Never sent twice, whatever the method (docs/rest.md "送り方").
      const raw = await client.requestRaw({ ...request, changesData: true }, { maxBodyBytes: MAX_REST_RESPONSE_BYTES })
      const elapsedMs = Math.round(performance.now() - started)
      if (id) record(() => finishRest(dir, client.username, id!, { state: 'done', status: raw.status, elapsedMs }))
      // No query string, body or header values in the log: they may hold record data.
      log.info(`rest ${request.method} ${pathname} ${raw.status} ${elapsedMs}ms`)
      sendJson(res, 200, { ...({ id, status: raw.status, ...restResponseBody(raw), elapsedMs } satisfies RestResponse), apiUsage: client.apiUsage })
    } catch (e) {
      if (id) record(() => finishRest(dir, client.username, id!, restOutcomeOf(e)))
      log.info(`rest ${request.method} ${pathname} ${(e as Error).name} ${Math.round(performance.now() - started)}ms`)
      throw e
    }
  }

  /**
   * The namespace header goes on queries only, as in lwc-soql-builder. If the
   * namespace cannot be read (for example, the user cannot query
   * Organization), the query still runs, without the header.
   */
  private async queryHeaders(client: OrgClient): Promise<Record<string, string>> {
    if (!this.options.settings.get().omitNamespace) return {}
    try {
      const { namespacePrefix } = await this.options.orgs.summary(client)
      return namespacePrefix ? { 'Sforce-Call-Options': `defaultNamespace=${namespacePrefix}` } : {}
    } catch (e) {
      if (e instanceof OrgAuthError || e instanceof SfNotFoundError) throw e
      log.warn(`${client.username}: could not read the namespace; querying without it`)
      return {}
    }
  }

  private requireAdmin(req: IncomingMessage): void {
    const token = req.headers['x-sfbench-admin']
    if (!isAdminRequestOrigin(req.headers) || typeof token !== 'string' || !sameSecret(token, this.options.adminToken)) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Admin token required')
    }
  }

  /**
   * Issues a one-time launch code. The org is kept as given (alias or
   * username): the web UI resolves it against the org list, so that the
   * browser opens without waiting for `sf org list`.
   */
  private createLaunch(body: Record<string, unknown>): { code: string; expiresAt: number } {
    const b = body as { org?: unknown; query?: unknown; run?: unknown; rest?: unknown; noOpen?: unknown }
    const launch: LaunchOptions = {}
    if (typeof b.org === 'string' && b.org) {
      if (b.org.length > 255) throw new HttpError(400, 'BAD_REQUEST', 'Org name too long')
      launch.org = b.org
    }
    if (typeof b.query === 'string' && b.query) launch.query = b.query
    if (b.run === true) launch.run = true
    if (b.rest !== undefined) {
      if (!b.rest || typeof b.rest !== 'object') throw new HttpError(400, 'BAD_REQUEST', 'rest must be an object')
      const r = b.rest as Record<string, unknown>
      try {
        launch.rest = restLaunch({ path: r.path, method: r.method, body: r.body })
      } catch (e) {
        throw new HttpError(400, 'BAD_REQUEST', (e as Error).message)
      }
    }
    this.pruneLaunches()
    const code = randomBytes(24).toString('base64url')
    const expiresAt = Date.now() + (b.noOpen === true ? LAUNCH_CODE_TTL_NO_OPEN_MS : LAUNCH_CODE_TTL_MS)
    this.launches.set(code, { launch, expiresAt })
    return { code, expiresAt }
  }

  private exchangeCode(body: unknown): SessionResponse {
    const code = (body as { code?: unknown } | undefined)?.code
    if (this.options.dev && code === DEV_LAUNCH_CODE && this.options.devSessionToken) {
      return { sessionToken: this.options.devSessionToken, launch: {} }
    }
    const pending = typeof code === 'string' ? this.launches.get(code) : undefined
    if (typeof code === 'string') this.launches.delete(code)
    if (!pending || pending.expiresAt < Date.now()) {
      throw new HttpError(410, 'UNAUTHORIZED', 'This URL has expired or was already used. Run `npx sfbench` to open sfbench again.')
    }
    const sessionToken = randomBytes(32).toString('base64url')
    this.sessions.add(sessionToken)
    return { sessionToken, launch: pending.launch }
  }

  private pruneLaunches(): void {
    const now = Date.now()
    for (const [code, pending] of this.launches) if (pending.expiresAt < now) this.launches.delete(code)
  }

  private async sendError(res: ServerResponse, e: unknown): Promise<void> {
    if (e instanceof OrgAuthError) {
      sendJson(res, 409, {
        error: {
          code: 'ORG_AUTH_ERROR',
          message: e.message,
          reloginCommand: await this.reloginCommand(e.username),
        },
      } satisfies ApiError)
      return
    }
    const { status, body } = errorResponse(e)
    sendJson(res, status, body)
  }

  /**
   * Runs an AI call that stops when the web UI goes away (Cancel, a closed
   * tab): the request to the AI is aborted too, and nothing is sent back.
   */
  private async runAi(res: ServerResponse, call: (signal: AbortSignal) => Promise<unknown>): Promise<void> {
    // Already gone while the body was read: 'close' has fired, so do not call the AI at all.
    if (res.destroyed || res.socket?.destroyed) return
    const gone = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) gone.abort()
    })
    try {
      sendJson(res, 200, await call(gone.signal))
    } catch (e) {
      if (gone.signal.aborted) return
      throw e
    }
  }

  private async reloginCommand(username: string): Promise<string> {
    const org = (await this.options.orgs.list().catch(() => [])).find((o) => o.username === username)
    return org ? reloginCommand(org) : 'sf org login web'
  }

  // ---- Static files ----

  private serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, errorBody('BAD_REQUEST', 'Method not allowed'))
      return
    }
    // The UI is a single page: / and /launch/<code> both get index.html.
    const isPage = pathname === '/' || pathname.startsWith('/launch/')
    const file = this.staticFiles.get(isPage ? '/index.html' : pathname)
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS })
      res.end(this.staticFiles.size === 0 ? 'The web UI is not built. Run `npm run build`.' : 'Not found')
      return
    }
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(isPage ? '/index.html' : pathname)] ?? 'application/octet-stream',
      'Cache-Control': cacheControl(pathname),
      ...SECURITY_HEADERS,
    })
    res.end(req.method === 'HEAD' ? undefined : file)
  }
}

/** Constant-time comparison, so that response times do not reveal the token. */
function sameSecret(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/**
 * The response for an error, apart from an org's login error (which needs the
 * relogin command). The codes are what the web UI sorts by (docs/web.md "エラーの扱い").
 */
export function errorResponse(e: unknown): { status: number; body: ApiError } {
  if (e instanceof HttpError) return { status: e.status, body: errorBody(e.code, e.message) }
  if (e instanceof SalesforceError) {
    const status = e.status >= 400 && e.status < 500 ? e.status : 502
    return { status, body: { error: { code: 'SALESFORCE_ERROR', message: e.message, status: e.status, details: e.body } } }
  }
  if (e instanceof SalesforceUnreachableError) return { status: 502, body: errorBody('SALESFORCE_UNREACHABLE', e.message) }
  if (e instanceof SalesforceTimeoutError) return { status: 504, body: errorBody('SALESFORCE_TIMEOUT', e.message) }
  if (e instanceof InvalidPathError || e instanceof RestRequestError || e instanceof NotJsonBodyError) return { status: 400, body: errorBody('BAD_REQUEST', e.message) }
  if (e instanceof SfNotFoundError) return { status: 503, body: errorBody('SF_CLI_NOT_FOUND', e.message) }
  if (e instanceof AiError) {
    const status = { AI_NOT_CONFIGURED: 400, AI_ERROR: 502, AI_BAD_OUTPUT: 502, AI_TIMEOUT: 504 }[e.code]
    return { status, body: { error: { code: e.code, message: e.message, details: e.details } } }
  }
  if (e instanceof AiSettingsError) return { status: 400, body: errorBody('BAD_REQUEST', e.message) }
  if (e instanceof SfCliError) {
    log.warn(`sf error: ${e.message}`)
    return { status: 502, body: errorBody('SF_CLI_ERROR', e.message) }
  }
  log.error(`error: ${(e as Error).stack ?? String(e)}`)
  return { status: 500, body: errorBody('INTERNAL_ERROR', 'Internal error') }
}

/**
 * How a failed REST request ends in the history: undefined when Salesforce
 * never processed it (the record is removed), else unknown.
 */
export function restOutcomeOf(e: unknown): RestOutcome | undefined {
  // Not sent, or refused by Salesforce for the session before it ran anything.
  if (e instanceof OrgAuthError || e instanceof SfNotFoundError || e instanceof NotJsonBodyError) return undefined
  if (e instanceof SalesforceTimeoutError) return { state: 'unknown', reason: 'timeout' }
  if (e instanceof SalesforceUnreachableError) return { state: 'unknown', reason: 'unreachable' }
  return { state: 'unknown', reason: 'error' }
}

/** An org that is not in the org list: not the 404 of an unknown path, which the UI must not take for a gone org. */
export function unknownOrg(username: string): Error {
  return new HttpError(404, 'ORG_NOT_FOUND', `Unknown org: ${username}`)
}

function errorBody(code: ApiErrorCode, message: string): ApiError {
  return { error: { code, message } }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body ?? null)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
  })
  res.end(data)
}

/** Reads a JSON object body. Anything else (empty, null, an array, a string) is a 400. */
async function readJsonObject(
  req: IncomingMessage,
  limit: { bytes: number; code: ApiErrorCode; message: string } = { bytes: MAX_BODY_BYTES, code: 'BAD_REQUEST', message: 'Request body too large' },
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit.bytes) throw new HttpError(413, limit.code, limit.message)
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'The request body must be a JSON object')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'BAD_REQUEST', 'The request body must be a JSON object')
  }
  return value as Record<string, unknown>
}
