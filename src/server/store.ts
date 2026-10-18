// Settings and query history, stored under ~/.sfbench. See docs/design.md ("データの保存").
import { join } from 'node:path'
import { AI_PROVIDERS, isValidTimeout, type AiKeyProvider, type AiProvider, type AiSettingsView, type HistoryEntry, type Settings, squashSoql, REST_METHODS, type ApexHistoryEntry, type ApexOutcome, type RestHistoryEntry, type RestMethod, type RestOutcome } from '../shared/api.ts'
import { randomUUID } from 'node:crypto'
import { readJson, writeFileAtomic } from './fsutil.ts'

/** The AI settings as saved, with the key (docs/ai.md "保存する形"). Never sent to the web UI. */
export type StoredAiSettings = {
  provider: AiProvider
  model: string
  apiKey?: string
  /** The provider the key was entered for: the key goes to no other. */
  keyProvider?: AiKeyProvider
}

/** Settings as saved in settings.json. */
export type StoredSettings = Omit<Settings, 'ai'> & { ai?: StoredAiSettings }

export const DEFAULT_SETTINGS: StoredSettings = { omitNamespace: true, requestTimeoutSeconds: 120 }

function isProvider(value: unknown): value is AiProvider {
  return (AI_PROVIDERS as readonly unknown[]).includes(value)
}

function loadAi(value: unknown): StoredAiSettings | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  if (!isProvider(v.provider)) return undefined
  const ai: StoredAiSettings = { provider: v.provider, model: typeof v.model === 'string' ? v.model : '' }
  // A key is kept only with the provider it was entered for (Off keeps it for when that provider is chosen again).
  const keyProvider = isProvider(v.keyProvider) && v.keyProvider !== 'off' ? v.keyProvider : undefined
  if (typeof v.apiKey === 'string' && v.apiKey && keyProvider && (v.provider === 'off' || v.provider === keyProvider)) {
    ai.apiKey = v.apiKey
    ai.keyProvider = keyProvider
  }
  return ai
}

export function loadSettings(file: string): StoredSettings {
  const stored = readJson(file)
  const s = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
  const settings: StoredSettings = {
    omitNamespace: typeof s.omitNamespace === 'boolean' ? s.omitNamespace : DEFAULT_SETTINGS.omitNamespace,
    requestTimeoutSeconds: isValidTimeout(s.requestTimeoutSeconds)
      ? s.requestTimeoutSeconds
      : DEFAULT_SETTINGS.requestTimeoutSeconds,
  }
  const ai = loadAi(s.ai)
  if (ai) settings.ai = ai
  return settings
}

/** Written with mode 0600 (writeFileAtomic): the file holds the AI's API key. */
export function saveSettings(file: string, settings: StoredSettings): void {
  writeFileAtomic(file, JSON.stringify(settings, null, 2))
}

/** What the web UI gets: the AI settings without the key. */
export function settingsView(settings: StoredSettings): Settings {
  const { ai, ...rest } = settings
  if (!ai) return rest
  const view: AiSettingsView = { provider: ai.provider, model: ai.model, hasApiKey: Boolean(ai.apiKey) }
  if (ai.apiKey && ai.keyProvider) view.keyProvider = ai.keyProvider
  return { ...rest, ai: view }
}

export class AiSettingsError extends Error {}

/**
 * Merges the AI settings sent by the web UI into the saved ones
 * (docs/ai.md "API"). Leaving out apiKey keeps the saved key, null removes
 * it, and choosing another provider (other than Off) drops it, so that a key
 * never goes to a provider it was not entered for.
 */
export function mergeAiSettings(saved: StoredAiSettings | undefined, input: unknown): StoredAiSettings {
  if (!input || typeof input !== 'object') throw new AiSettingsError('ai must be an object.')
  const v = input as Record<string, unknown>
  if (!isProvider(v.provider)) throw new AiSettingsError('ai.provider must be off, anthropic or openai.')
  if (v.model !== undefined && typeof v.model !== 'string') throw new AiSettingsError('ai.model must be a string.')
  if (v.apiKey !== undefined && v.apiKey !== null && typeof v.apiKey !== 'string') {
    throw new AiSettingsError('ai.apiKey must be a string or null.')
  }
  const provider = v.provider
  const model = typeof v.model === 'string' ? v.model.trim() : (saved?.model ?? '')
  if (provider !== 'off' && !model) throw new AiSettingsError('Enter the model ID.')

  let apiKey = saved?.apiKey
  let keyProvider = saved?.keyProvider
  if (provider !== 'off' && keyProvider !== provider) {
    apiKey = undefined
    keyProvider = undefined
  }
  if (v.apiKey === null) {
    apiKey = undefined
    keyProvider = undefined
  } else if (typeof v.apiKey === 'string' && v.apiKey.trim() && provider !== 'off') {
    apiKey = v.apiKey.trim()
    keyProvider = provider
  }
  const merged: StoredAiSettings = { provider, model }
  if (apiKey && keyProvider) {
    merged.apiKey = apiKey
    merged.keyProvider = keyProvider
  }
  return merged
}

/**
 * Settings kept in memory: they are read on every Salesforce request, so the
 * file is read once at startup and written on each change.
 */
export class SettingsStore {
  private readonly file: string
  private current: StoredSettings

  constructor(file: string) {
    this.file = file
    this.current = loadSettings(file)
  }

  get(): StoredSettings {
    return this.current
  }

  set(settings: StoredSettings): StoredSettings {
    saveSettings(this.file, settings)
    this.current = settings
    return settings
  }
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

/**
 * Adds a successful query. The same query moves to the top instead of being
 * added twice, keeping the request to the AI that wrote it if this run has none.
 */
export function addHistory(dir: string, username: string, entry: HistoryEntry): HistoryEntry[] {
  const sameQuery = (e: HistoryEntry) =>
    squashSoql(e.soql) === squashSoql(entry.soql) && e.tooling === entry.tooling && e.queryAll === entry.queryAll
  const previous = loadHistory(dir, username)
  const prompt = entry.prompt ?? previous.find(sameQuery)?.prompt
  const added = prompt ? { ...entry, prompt } : entry
  const entries = [added, ...previous.filter((e) => !sameQuery(e))].slice(0, MAX_HISTORY)
  writeFileAtomic(historyFile(dir, username), JSON.stringify(entries, null, 2))
  return entries
}

/** At most this much of a request body is kept in the REST history (docs/rest.md "残すもの"). */
export const MAX_REST_HISTORY_BODY = 32 * 1024

// The histories of requests that may change data: the REST API screen's and
// the Apex screen's (docs/rest.md "実行履歴", docs/apex.md "実行履歴"). A record
// is written as pending just before the request goes, and rewritten when it
// ends, so that what was sent is known even if the screen goes away.

/** A record as stored: with the server that sent it. */
type Stored<T> = T & { bootId?: string }

type ExecRecord = { id: string; sentAt: string; outcome: { state: 'pending' | 'done' | 'unknown' } & Record<string, unknown> }

function isExecRecord(e: unknown): e is ExecRecord {
  if (!e || typeof e !== 'object') return false
  const r = e as Record<string, unknown>
  const outcome = r.outcome as Record<string, unknown> | undefined
  return typeof r.id === 'string' && typeof r.sentAt === 'string' && !!outcome && ['pending', 'done', 'unknown'].includes(outcome.state as string)
}

function loadExec<T extends ExecRecord>(file: string, valid: (e: Record<string, unknown>) => boolean): Stored<T>[] {
  const stored = readJson(file)
  // A record of another shape (a damaged or hand-edited file) is dropped.
  return Array.isArray(stored) ? (stored.filter((e) => isExecRecord(e) && valid(e as unknown as Record<string, unknown>)) as Stored<T>[]) : []
}

/** Newest first. A request still pending from a server that has stopped (another bootId) shows as unknown, not as waiting for ever. */
function loadExecHistory<T extends ExecRecord>(file: string, bootId: string, valid: (e: Record<string, unknown>) => boolean): T[] {
  return loadExec<T>(file, valid).map(({ bootId: entryBoot, ...entry }) =>
    entry.outcome.state === 'pending' && entryBoot !== bootId ? ({ ...entry, outcome: { state: 'unknown', reason: 'stopped' } } as unknown as T) : (entry as unknown as T),
  )
}

/** Records a request as pending; the same request twice is two records. Returns its id. */
function addExecPending(file: string, fields: Record<string, unknown>, bootId: string, valid: (e: Record<string, unknown>) => boolean): string {
  const id = randomUUID()
  const entry = { id, ...fields, sentAt: new Date().toISOString(), outcome: { state: 'pending' }, bootId }
  const entries = [entry, ...loadExec(file, valid)].slice(0, MAX_HISTORY)
  // Not indented: the file is rewritten twice for each request.
  writeFileAtomic(file, JSON.stringify(entries))
  return id
}

/** Writes how a request ended; `undefined` removes the record (never processed). A missing record is not added again. */
function finishExec(file: string, id: string, outcome: object | undefined, valid: (e: Record<string, unknown>) => boolean): void {
  const entries = loadExec(file, valid)
  if (!entries.some((e) => e.id === id)) return
  const next = outcome ? entries.map((e) => (e.id === id ? { ...e, outcome } : e)) : entries.filter((e) => e.id !== id)
  writeFileAtomic(file, JSON.stringify(next))
}

const isRestRecord = (r: Record<string, unknown>) => typeof r.method === 'string' && (REST_METHODS as readonly string[]).includes(r.method) && typeof r.path === 'string'

export function loadRestHistory(dir: string, username: string, bootId: string): RestHistoryEntry[] {
  return loadExecHistory(historyFile(dir, username), bootId, isRestRecord) as unknown as RestHistoryEntry[]
}

/** Records a REST request just before it is sent, as pending. Returns its id. */
export function addRestPending(
  dir: string,
  username: string,
  request: { method: RestMethod; path: string; headers: Record<string, string>; body?: string },
  bootId: string,
): string {
  const keepBody = request.body !== undefined && Buffer.byteLength(request.body) <= MAX_REST_HISTORY_BODY
  return addExecPending(
    historyFile(dir, username),
    {
      method: request.method,
      path: request.path,
      ...(Object.keys(request.headers).length ? { headers: request.headers } : {}),
      ...(keepBody ? { body: request.body } : request.body !== undefined ? { bodyOmitted: true } : {}),
    },
    bootId,
    isRestRecord,
  )
}

export function finishRest(dir: string, username: string, id: string, outcome: RestOutcome | undefined): void {
  finishExec(historyFile(dir, username), id, outcome, isRestRecord)
}

const isApexRecord = (r: Record<string, unknown>) => typeof r.code === 'string'

export function loadApexHistory(dir: string, username: string, bootId: string): ApexHistoryEntry[] {
  return loadExecHistory(historyFile(dir, username), bootId, isApexRecord) as unknown as ApexHistoryEntry[]
}

/** Records Apex just before it runs, as pending, with the whole code (at most MAX_APEX_CODE). Returns its id. */
export function addApexPending(dir: string, username: string, code: string, bootId: string): string {
  return addExecPending(historyFile(dir, username), { code }, bootId, isApexRecord)
}

export function finishApex(dir: string, username: string, id: string, outcome: ApexOutcome | undefined): void {
  finishExec(historyFile(dir, username), id, outcome, isApexRecord)
}
