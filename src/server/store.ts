// Settings and query history, stored under ~/.sfbench. See docs/design.md ("データの保存").
import { join } from 'node:path'
import type { HistoryEntry, Settings } from '../shared/api.ts'
import { readJson, writeFileAtomic } from './fsutil.ts'

const DEFAULT_SETTINGS: Settings = { omitNamespace: true }

export function loadSettings(file: string): Settings {
  const stored = readJson(file)
  const s = stored && typeof stored === 'object' ? (stored as Partial<Settings>) : {}
  return {
    omitNamespace: typeof s.omitNamespace === 'boolean' ? s.omitNamespace : DEFAULT_SETTINGS.omitNamespace,
  }
}

export function saveSettings(file: string, settings: Settings): void {
  writeFileAtomic(file, JSON.stringify(settings, null, 2))
}

export const MAX_HISTORY = 100

/** File name for an org's history: characters other than letters, digits, @ . - _ become _. */
export function historyFile(dir: string, username: string): string {
  return join(dir, `${username.replace(/[^A-Za-z0-9@._-]/g, '_')}.json`)
}

export function loadHistory(dir: string, username: string): HistoryEntry[] {
  const stored = readJson(historyFile(dir, username))
  return Array.isArray(stored) ? (stored as HistoryEntry[]) : []
}

/** Adds a successful query. The same query moves to the top instead of being added twice. */
export function addHistory(dir: string, username: string, entry: HistoryEntry): HistoryEntry[] {
  const sameQuery = (e: HistoryEntry) =>
    e.soql.trim() === entry.soql.trim() && e.tooling === entry.tooling && e.queryAll === entry.queryAll
  const entries = [entry, ...loadHistory(dir, username).filter((e) => !sameQuery(e))].slice(0, MAX_HISTORY)
  writeFileAtomic(historyFile(dir, username), JSON.stringify(entries, null, 2))
  return entries
}
