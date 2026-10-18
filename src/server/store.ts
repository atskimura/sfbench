// Settings and query history, stored under ~/.sfbench. See docs/design.md ("データの保存").
import { join } from 'node:path'
import { AI_PROVIDERS, isValidTimeout, type AiKeyProvider, type AiProvider, type AiSettingsView, type HistoryEntry, type Settings, squashSoql } from '../shared/api.ts'
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
