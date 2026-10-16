import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acquireLock, compareVersions, readServerInfo, removeServerInfo, writeServerInfo } from './state.ts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sfbench-state-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('compareVersions', () => {
  it.each([
    ['0.1.0', '0.1.0', 0],
    ['0.2.0', '0.1.9', 1],
    ['0.10.0', '0.9.0', 1],
    ['1.0.0', '1.0.1', -1],
    ['1.0.0-beta.1', '1.0.0', 0],
  ])('%s vs %s', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected)
  })
})

describe('server.json', () => {
  it('round-trips and is removed only by its own process', () => {
    const file = join(dir, 'server.json')
    const info = { port: 7717, adminToken: 'abc', pid: 12345, version: '0.1.0' }
    writeServerInfo(file, info)
    expect(readServerInfo(file)).toEqual(info)
    removeServerInfo(file, 999)
    expect(readServerInfo(file)).toEqual(info)
    removeServerInfo(file, 12345)
    expect(readServerInfo(file)).toBeUndefined()
  })

  it('ignores a malformed file', () => {
    const file = join(dir, 'server.json')
    writeFileSync(file, '{"port":"7717"}')
    expect(readServerInfo(file)).toBeUndefined()
  })
})

describe('acquireLock', () => {
  it('creates and releases the lock', async () => {
    const file = join(dir, 'server.lock')
    const release = await acquireLock(file)
    expect(existsSync(file)).toBe(true)
    release()
    expect(existsSync(file)).toBe(false)
  })

  it('takes over a lock whose process no longer exists', async () => {
    const file = join(dir, 'server.lock')
    writeFileSync(file, JSON.stringify({ pid: 2 ** 22 + 12345, createdAt: Date.now() }))
    const release = await acquireLock(file)
    release()
  })

  it('takes over a lock older than 60 seconds', async () => {
    const file = join(dir, 'server.lock')
    writeFileSync(file, JSON.stringify({ pid: process.pid, createdAt: Date.now() - 61_000 }))
    const release = await acquireLock(file)
    release()
  })

  it('waits while a live process holds the lock', async () => {
    const file = join(dir, 'server.lock')
    const release1 = await acquireLock(file)
    let acquired = false
    const second = acquireLock(file).then((release) => {
      acquired = true
      return release
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(acquired).toBe(false)
    release1()
    ;(await second)()
    expect(acquired).toBe(true)
  })
})
