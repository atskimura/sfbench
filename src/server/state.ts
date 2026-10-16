// server.json and server.lock. Their format is part of the contract that must
// not change between versions: a newer CLI entry point has to find, use or
// stop an older server. See docs/design.md ("バージョンをまたいで変えない契約").
import { randomBytes } from 'node:crypto'
import { closeSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { readJson, writeFileAtomic } from './fsutil.ts'

export type ServerInfo = {
  port: number
  adminToken: string
  pid: number
  version: string
}

export function readServerInfo(file: string): ServerInfo | undefined {
  const v = readJson(file) as Partial<ServerInfo> | undefined
  if (
    v &&
    typeof v.port === 'number' &&
    typeof v.adminToken === 'string' &&
    typeof v.pid === 'number' &&
    typeof v.version === 'string'
  ) {
    return { port: v.port, adminToken: v.adminToken, pid: v.pid, version: v.version }
  }
  return undefined
}

export function writeServerInfo(file: string, info: ServerInfo): void {
  writeFileAtomic(file, JSON.stringify(info, null, 2))
}

/** Removes server.json if it still describes this process. */
export function removeServerInfo(file: string, pid: number): void {
  if (readServerInfo(file)?.pid === pid) rmSync(file, { force: true })
}

/** Compares "x.y.z" versions. Pre-release suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return Math.sign(d)
  }
  return 0
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM: the process exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const LOCK_WAIT_MS = 20_000
const LOCK_STALE_MS = 60_000
const LOCK_POLL_MS = 200

export class LockTimeoutError extends Error {
  constructor() {
    super('Another sfbench is starting. Try again in a moment.')
    this.name = 'LockTimeoutError'
  }
}

type LockContent = { pid: number; createdAt: number }

function isStale(file: string, now: number): boolean {
  let content: LockContent | undefined
  try {
    content = JSON.parse(readFileSync(file, 'utf8')) as LockContent
  } catch {
    // Unreadable: either being written right now or corrupt. Judge by age.
    const mtime = statSync(file, { throwIfNoEntry: false })?.mtimeMs
    return mtime === undefined || now - mtime > LOCK_STALE_MS
  }
  return now - content.createdAt > LOCK_STALE_MS || !isProcessAlive(content.pid)
}

/**
 * Takes server.lock, waiting up to 20 seconds. Returns a function that releases it.
 * A lock whose process is gone, or that is older than 60 seconds, is stale.
 */
export async function acquireLock(file: string): Promise<() => void> {
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      const fd = openSync(file, 'wx', 0o600)
      writeSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() } satisfies LockContent))
      closeSync(fd)
      return () => rmSync(file, { force: true })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
    if (isStale(file, Date.now())) {
      // Rename before deleting: if two processes find the same stale lock, only
      // one rename succeeds, so neither deletes a lock the other just created.
      const aside = `${file}.stale-${randomBytes(6).toString('hex')}`
      try {
        renameSync(file, aside)
        rmSync(aside, { force: true })
      } catch {
        // Someone else handled it.
      }
      continue
    }
    if (Date.now() > deadline) throw new LockTimeoutError()
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS))
  }
}
