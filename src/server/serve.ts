// The server process. In normal use the CLI entry point starts it detached in
// the background; `npm run dev:server` runs it in the foreground.
import { randomBytes } from 'node:crypto'
import { readdirSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { readJson, writeFileAtomic } from './fsutil.ts'
import { App } from './http/server.ts'
import { initLog, log } from './log.ts'
import { OrgRegistry } from './orgs.ts'
import { ensureDirs, resolvePaths, webRoot, type Paths } from './paths.ts'
import { removeServerInfo, writeServerInfo } from './state.ts'
import { packageVersion } from './version.ts'

export const DEFAULT_PORT = 7717
const LAST_PORT = 7736
export const DEV_PORT = 17717
const DEV_WEB_URL = 'http://localhost:5173/launch/dev'

function listen(server: Server, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (e: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      if (e.code === 'EADDRINUSE') resolve(false)
      else reject(e)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve(true)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

/** In dev mode, a session token that survives restarts, so that `node --watch` restarts do not log the UI out. */
function devSessionToken(paths: Paths): string {
  const file = join(paths.home, 'dev-session.json')
  const stored = readJson(file) as { token?: unknown } | undefined
  if (typeof stored?.token === 'string') return stored.token
  const token = randomBytes(32).toString('base64url')
  writeFileAtomic(file, JSON.stringify({ token }))
  return token
}

function cleanTmp(dir: string): void {
  for (const name of readdirSync(dir)) rmSync(join(dir, name), { recursive: true, force: true })
}

export async function serve(dev: boolean): Promise<void> {
  const paths = resolvePaths(dev)
  ensureDirs(paths)
  initLog(paths.serverLog, dev)
  cleanTmp(paths.tmpDir)
  // Child processes inherit this directory. A fixed, private directory keeps
  // cmd.exe on Windows from finding executables in the user's project.
  process.chdir(paths.tmpDir)

  const version = packageVersion()
  const adminToken = randomBytes(32).toString('base64url')
  const orgs = new OrgRegistry(paths.tmpDir, process.env.SFBENCH_TRANSPORT === 'cli')
  let server: Server | undefined

  const shutdown = () => {
    log.info('shutting down')
    removeServerInfo(paths.serverJson, process.pid)
    server?.close()
    server?.closeAllConnections()
    setTimeout(() => process.exit(0), 100).unref()
  }

  const ports = dev ? [DEV_PORT] : Array.from({ length: LAST_PORT - DEFAULT_PORT + 1 }, (_, i) => DEFAULT_PORT + i)
  for (const port of ports) {
    const app = new App({
      version,
      dev,
      port,
      adminToken,
      paths,
      orgs,
      webRoot: dev ? undefined : webRoot,
      devSessionToken: dev ? devSessionToken(paths) : undefined,
      onShutdown: shutdown,
    })
    const candidate = app.createServer()
    if (await listen(candidate, port)) {
      server = candidate
      // Written after listening, and atomically, so that the CLI entry point
      // never sees a server.json for a server that is not ready.
      writeServerInfo(paths.serverJson, { port, adminToken, pid: process.pid, version })
      log.info(`sfbench ${version} listening on 127.0.0.1:${port}${dev ? ' (dev)' : ''}`)
      break
    }
  }
  if (!server) {
    const message = dev
      ? `Port ${DEV_PORT} is in use. Stop the other development server first.`
      : `No free port between ${DEFAULT_PORT} and ${LAST_PORT}.`
    log.error(message)
    process.exitCode = 1
    return
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  if (dev) process.stderr.write(`\nOpen ${DEV_WEB_URL} after starting \`npm run dev:web\`.\n\n`)

  // Load the org list in the background: it can take several seconds.
  orgs.list().catch((e: Error) => log.warn(`could not load the org list: ${e.message}`))
}
