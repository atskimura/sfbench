// The CLI entry point's work: find or start the background server, then open
// a new browser tab. See docs/design.md ("起動").
import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openBrowser } from './browser.ts'
import { ensureDirs, resolvePaths, type Paths } from './paths.ts'
import { getDefaultOrg } from './sf/commands.ts'
import { SfNotFoundError } from './sf/errors.ts'
import { acquireLock, compareVersions, readServerInfo, type ServerInfo } from './state.ts'
import { packageVersion } from './version.ts'
import type { LaunchOptions } from '../shared/api.ts'

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
  /** Put in the REST API screen, never sent (docs/rest.md "`--rest` の起動時の指定"). */
  rest?: LaunchOptions['rest']
  /** Put in the Apex screen, never run (docs/apex.md "`--apex` の起動時の指定"). */
  apex?: LaunchOptions['apex']
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

type Started = {
  pid: number
  /** Set when the server process ended. */
  ended: () => boolean
  /** What the server wrote to stderr: why it ended, when it could not write its log. */
  stderr: () => string
  /** Where that is, in full; undefined when it could not be kept. */
  stderrFile: string | undefined
}

/**
 * Opens a file for the server's stderr, one per start, so that a server still
 * running from before keeps its own. The server removes it once it listens
 * (serve.ts): it is kept only to tell why a start failed. Undefined when it
 * cannot be opened; the server then starts with its stderr ignored.
 */
function openStderrFile(paths: Paths): { file: string; fd: number } | undefined {
  const file = join(paths.tmpDir, `server-stderr-${Date.now()}-${process.pid}.log`)
  try {
    return { file, fd: openSync(file, 'w', 0o600) }
  } catch {
    return undefined
  }
}

function startServer(paths: Paths): Started {
  // cli.js next to this file when installed; cli.ts when run from the sources.
  const cli = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './cli.ts' : './cli.js', import.meta.url))
  // Node.js refusing to start the server (an unknown option, a missing module)
  // says so on stderr, before the server can log anything.
  const stderr = openStderrFile(paths)
  let ended = false
  try {
    const child = spawn(process.execPath, ['--use-env-proxy', cli, 'serve'], {
      cwd: paths.tmpDir,
      detached: true,
      stdio: ['ignore', 'ignore', stderr ? stderr.fd : 'ignore'],
      env: { ...process.env, ...(stderr ? { SFBENCH_STDERR_FILE: stderr.file } : {}) },
      windowsHide: true,
    })
    child.on('exit', () => (ended = true))
    child.on('error', () => (ended = true))
    child.unref()
    if (child.pid === undefined) throw new UserError('Could not start the sfbench server.')
    return {
      pid: child.pid,
      ended: () => ended,
      stderr: () => {
        if (!stderr) return ''
        try {
          return readFileSync(stderr.file, 'utf8').trim().slice(0, 2000)
        } catch {
          return ''
        }
      },
      stderrFile: stderr?.file,
    }
  } finally {
    if (stderr) closeSync(stderr.fd)
  }
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

  const server = startServer(paths)
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline && !server.ended()) {
    await sleep(200)
    const info = readServerInfo(paths.serverJson)
    if (info?.pid === server.pid && (await health(info)) !== undefined) return info
  }
  const said = server.stderr()
  // The server removes its stderr file once it listens: named only while it is there.
  const files = [paths.serverLog, ...(server.stderrFile && existsSync(server.stderrFile) ? [server.stderrFile] : [])].join(' and ')
  throw new UserError(`The sfbench server did not start${said ? `:\n${said}` : '.'}\nSee ${files}.`)
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
  if (options.rest && (options.query || options.run)) throw new UserError('--rest cannot be used with --query or --run.')
  if (options.apex && (options.query || options.run || options.rest)) throw new UserError('--apex cannot be used with --query, --run or --rest.')
  const org = await resolveOrg(options)
  if (options.run && !org) {
    throw new UserError('No org to run the query in. Pass -o <alias>, or set a default org with `sf config set target-org <alias>`.')
  }
  // A request that may change data goes only into the org it was meant for.
  if (options.rest && !org) {
    throw new UserError('No org for the REST request. Pass -o <alias>, or set a default org with `sf config set target-org <alias>`.')
  }
  if (options.apex && !org) {
    throw new UserError('No org for the Apex. Pass -o <alias>, or set a default org with `sf config set target-org <alias>`.')
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

  const res = await admin(info, 'POST', '/api/launch', { org, query: options.query, run: options.run, rest: options.rest, apex: options.apex, noOpen: !options.open })
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
