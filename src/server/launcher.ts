// The CLI entry point's work: find or start the background server, then open
// a new browser tab. See docs/design.md ("起動").
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { openBrowser } from './browser.ts'
import { ensureDirs, resolvePaths, type Paths } from './paths.ts'
import { getDefaultOrg } from './sf/commands.ts'
import { SfNotFoundError } from './sf/errors.ts'
import { acquireLock, compareVersions, readServerInfo, type ServerInfo } from './state.ts'
import { packageVersion } from './version.ts'

const START_TIMEOUT_MS = 15_000
const STOP_TIMEOUT_MS = 5_000
const HEALTH_TIMEOUT_MS = 2_000

export class UserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserError'
  }
}

export type OpenOptions = {
  targetOrg?: string
  query?: string
  run: boolean
  json: boolean
  open: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Calls an admin endpoint. Node's fetch sends no Origin header, which the server requires for admin calls. */
async function admin(
  info: ServerInfo,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  timeoutMs = HEALTH_TIMEOUT_MS,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${info.port}${path}`, {
    method,
    headers: { 'X-Sfbench-Admin': info.adminToken, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  })
}

/** The version of the server described by `info`, or undefined if it does not answer. */
async function health(info: ServerInfo): Promise<string | undefined> {
  try {
    const res = await admin(info, 'GET', '/api/health')
    if (!res.ok) return undefined
    return ((await res.json()) as { version?: string }).version
  } catch {
    return undefined
  }
}

/** Asks a server to stop and waits until it no longer answers. */
async function stopServer(info: ServerInfo): Promise<boolean> {
  try {
    await admin(info, 'POST', '/api/shutdown')
  } catch {
    // It may already be gone.
  }
  const deadline = Date.now() + STOP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if ((await health(info)) === undefined) return true
    await sleep(200)
  }
  return false
}

function startServer(paths: Paths): number {
  // cli.js next to this file when installed; cli.ts when run from the sources.
  const cli = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './cli.ts' : './cli.js', import.meta.url))
  const child = spawn(process.execPath, ['--use-env-proxy', cli, 'serve'], {
    cwd: paths.tmpDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  if (child.pid === undefined) throw new UserError('Could not start the sfbench server.')
  return child.pid
}

/** Returns a running server of this version or newer, starting one if needed. Call with server.lock held. */
async function ensureServer(paths: Paths): Promise<ServerInfo> {
  const mine = packageVersion()
  const existing = readServerInfo(paths.serverJson)
  if (existing) {
    const running = await health(existing)
    if (running !== undefined) {
      // A newer server is used as is, so that two sfbench versions on one
      // computer do not keep stopping each other's server.
      if (compareVersions(running, mine) >= 0) return existing
      if (!(await stopServer(existing))) {
        process.stderr.write(`An older sfbench server (${running}) did not stop. Starting another one.\n`)
      }
    }
  }

  const pid = startServer(paths)
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(200)
    const info = readServerInfo(paths.serverJson)
    if (info?.pid === pid && (await health(info)) !== undefined) return info
  }
  throw new UserError(`The sfbench server did not start. See ${paths.serverLog}.`)
}

async function resolveOrg(options: OpenOptions): Promise<string | undefined> {
  if (options.targetOrg) return options.targetOrg
  try {
    // In the user's working directory: a project can set its own default org.
    return await getDefaultOrg(process.cwd())
  } catch (e) {
    if (e instanceof SfNotFoundError) throw new UserError(e.message)
    return undefined
  }
}

export async function openSfbench(options: OpenOptions): Promise<void> {
  if (options.run && !options.query) throw new UserError('--run needs --query.')
  const org = await resolveOrg(options)
  if (options.run && !org) {
    throw new UserError('No org to run the query in. Pass -o <alias>, or set a default org with `sf config set target-org <alias>`.')
  }

  const paths = resolvePaths(false)
  ensureDirs(paths)
  const release = await acquireLock(paths.serverLock)
  let info: ServerInfo
  try {
    info = await ensureServer(paths)
  } finally {
    release()
  }

  const res = await admin(info, 'POST', '/api/launch', { org, query: options.query, run: options.run, noOpen: !options.open })
  if (!res.ok) {
    const body = (await res.json().catch(() => undefined)) as { error?: { message?: string } } | undefined
    throw new UserError(body?.error?.message ?? `sfbench could not open (HTTP ${res.status}).`)
  }
  const { code } = (await res.json()) as { code: string }
  const url = `http://127.0.0.1:${info.port}/launch/${code}`
  const opened = options.open ? await openBrowser(url) : false

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ url, opened, port: info.port, org: org ?? null })}\n`)
  } else if (opened) {
    process.stdout.write(`Opened sfbench in your browser.\n`)
  } else {
    process.stdout.write(`Open this URL in your browser within ${options.open ? 'a minute' : '10 minutes'}:\n${url}\n`)
  }
}

export async function stopSfbench(): Promise<void> {
  const paths = resolvePaths(false)
  const info = readServerInfo(paths.serverJson)
  if (!info || (await health(info)) === undefined) {
    process.stdout.write('sfbench is not running.\n')
    return
  }
  if (await stopServer(info)) process.stdout.write('Stopped sfbench.\n')
  else throw new UserError('sfbench did not stop.')
}
