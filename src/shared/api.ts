// Types of the local server's HTTP API, shared by the server and the web UI.
// See docs/design.md ("API").

export type OrgKind = 'production' | 'sandbox' | 'scratch' | 'devhub'

/**
 * Whether the org can be used (docs/screens.md "組織の切り替え").
 * - unknown: not checked yet
 * - ok: the sf CLI could connect
 * - authError: the login expired; logging in again fixes it
 * - unavailable: deleted, expired or unreachable (hidden from the list)
 */
export type OrgAvailability = 'unknown' | 'ok' | 'authError' | 'unavailable'

export type Org = {
  username: string
  alias?: string
  instanceUrl: string
  kind: OrgKind
  /** `orgEdition` from `sf org list`, such as "Developer Edition". Not always known. */
  edition?: string
  /** Expiration date of a scratch org (YYYY-MM-DD). */
  expirationDate?: string
  isExpired: boolean
  availability: OrgAvailability
  /** For authError: the command that logs in to the org again. */
  reloginCommand?: string
}

export type OrgsResponse = {
  orgs: Org[]
  /** The background connection check (`sf org list` with connection status). */
  connectionCheck: 'pending' | 'done' | 'failed'
}

export type OrgSummary = {
  /** `Organization.OrganizationType`, such as "Developer Edition". */
  organizationType: string
  isSandbox: boolean
  namespacePrefix: string | null
}

export type ApiUsage = { used: number; max: number }

export type QueryRequest = {
  soql: string
  tooling?: boolean
  queryAll?: boolean
}

export type NextPageRequest = { nextRecordsUrl: string }

export type QueryResponse = {
  totalSize: number
  done: boolean
  nextRecordsUrl?: string
  records: Record<string, unknown>[]
}

/** Every successful response from an org endpoint carries the latest API usage. */
export type WithApiUsage<T> = T & { apiUsage?: ApiUsage }

export type HistoryEntry = {
  soql: string
  tooling: boolean
  queryAll: boolean
  /** ISO 8601 */
  executedAt: string
  /** The request the user typed for the AI (milestone 3). */
  prompt?: string
}

export type HistoryResponse = { entries: HistoryEntry[] }

export const MIN_TIMEOUT_SECONDS = 10
export const MAX_TIMEOUT_SECONDS = 600

export function isValidTimeout(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= MIN_TIMEOUT_SECONDS && (value as number) <= MAX_TIMEOUT_SECONDS
}

export type Settings = {
  omitNamespace: boolean
  /** How long to wait for Salesforce, in seconds (10 to 600). */
  requestTimeoutSeconds: number
  /** Undefined until the user chooses an AI (or Off) in the settings (docs/ai.md "設定"). */
  ai?: AiSettingsView
}

/** The AI providers sfbench can call: Anthropic or OpenAI, or none (docs/ai.md). */
export const AI_PROVIDERS = ['off', 'anthropic', 'openai'] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]
/** The providers that take a key. */
export type AiKeyProvider = Exclude<AiProvider, 'off'>

/** The AI settings as the web UI sees them: the key itself never leaves the server. */
export type AiSettingsView = {
  provider: AiProvider
  model: string
  hasApiKey: boolean
  /** The provider the saved key is for (the key goes to no other). */
  keyProvider?: AiKeyProvider
}

/** AI settings sent from the web UI. Leaving out apiKey keeps the saved key; null removes it. */
export type AiSettingsInput = {
  provider: AiProvider
  model?: string
  apiKey?: string | null
}

/** PUT /api/settings: leaving out a part keeps what is saved. */
export type SettingsUpdate = {
  omitNamespace?: boolean
  requestTimeoutSeconds?: number
  ai?: AiSettingsInput
}

/** UI language, for the language of the AI's explanations. */
export type UiLanguage = 'en' | 'ja'

/** What the AI is asked to do (docs/ai.md "タスク"), with what it is given. */
export type AiTaskRequest =
  | {
      task: 'chooseObjects'
      input: {
        request: string
        /** One object per line: `ApiName (Label)`. */
        objects: string
        tooling: boolean
        language: UiLanguage
      }
    }
  | {
      task: 'generateSoql'
      input: {
        request: string
        /** Fields of the objects, in the line format of docs/ai.md. */
        objectInfo: string
        editorText: string
        tooling: boolean
        language: UiLanguage
      }
    }
  | {
      task: 'fixSoql'
      input: {
        soql: string
        error: string
        objectInfo: string
        tooling: boolean
        language: UiLanguage
      }
    }

export type AiTask = AiTaskRequest['task']

export type ChooseObjectsOutput = { objects: string[] }
export type SoqlOutput = { soql: string; explanation: string }

export type AiOutput<T extends AiTask> = T extends 'chooseObjects' ? ChooseObjectsOutput : SoqlOutput

/** POST /api/ai/test: tries the settings being edited, without saving them. */
export type AiTestRequest = { ai: AiSettingsInput }
export type AiTestResponse = { elapsedMs: number }

/** describe results carry the time the server fetched them (ISO 8601). */
export type WithFetchedAt<T> = T & { fetchedAt: string }

export type LaunchOptions = {
  /**
   * The org to open, as given on the command line or as the sf CLI's default
   * org: an alias or a username. The web UI matches it against the org list.
   */
  org?: string
  query?: string
  run?: boolean
}

export type SessionRequest = { code: string }

export type SessionResponse = {
  sessionToken: string
  launch: LaunchOptions
}

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'ORG_AUTH_ERROR'
  | 'SF_CLI_NOT_FOUND'
  | 'SF_CLI_ERROR'
  | 'SALESFORCE_ERROR'
  | 'AI_NOT_CONFIGURED'
  | 'AI_ERROR'
  | 'AI_BAD_OUTPUT'
  | 'AI_TIMEOUT'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL_ERROR'

export type ApiError = {
  error: {
    code: ApiErrorCode
    message: string
    /** For ORG_AUTH_ERROR: the command that logs in to the org again. */
    reloginCommand?: string
    /** For SALESFORCE_ERROR: the HTTP status and body Salesforce returned. */
    status?: number
    details?: unknown
  }
}
