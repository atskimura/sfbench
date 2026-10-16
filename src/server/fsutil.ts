import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'

/** Writes a file so that readers never see a partial file: write to a temporary file, then rename. */
export function writeFileAtomic(path: string, data: string): void {
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(tmp, data, { mode: 0o600 })
  renameSync(tmp, path)
}

/** Reads and parses a JSON file. Returns undefined if it does not exist or is not valid JSON. */
export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}
