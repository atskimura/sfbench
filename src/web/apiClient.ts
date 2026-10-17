// Calls the local sfbench server. See docs/design.md ("API") and docs/web.md ("エラーの扱い").
import type {
  AiOutput,
  AiTask,
  AiTaskRequest,
  AiTestRequest,
  AiTestResponse,
  ApiError,
  ApiErrorCode,
  ApiUsage,
  HistoryResponse,
  OrgsResponse,
  OrgSummary,
  QueryRequest,
  QueryResponse,
  SessionResponse,
  Settings,
  SettingsUpdate,
  WithApiUsage,
  WithFetchedAt,
} from '../shared/api.ts'

const SESSION_KEY = 'sfbench.session'

export function getSessionToken(): string | undefined {
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function setSessionToken(token: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY, token)
  } catch {
    // Without sessionStorage the session still works until the tab reloads.
  }
  memoryToken = token
}

let memoryToken: string | undefined

/** An error from the server, or `status: 0` when the server could not be reached. */
export class ApiRequestError extends Error {
  readonly status: number
  readonly code: ApiErrorCode | 'NETWORK_ERROR' | 'ABORTED'
  readonly body: ApiError['error'] | undefined
  constructor(status: number, code: ApiRequestError['code'], message: string, body?: ApiError['error']) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.body = body
  }

  /** The session is no longer valid (the server restarted or stopped). */
  get isSessionLost(): boolean {
    return (this.status === 401 && this.code === 'UNAUTHORIZED') || this.code === 'NETWORK_ERROR'
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const token = memoryToken ?? getSessionToken()
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(token ? { 'X-Sfbench-Session': token } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new ApiRequestError(0, 'ABORTED', 'Aborted')
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'Could not reach the sfbench server.')
  }
  const json = (await res.json().catch((e: unknown) => {
    // Cancelled while the body was arriving: an abort, not an empty reply.
    if ((e as Error).name === 'AbortError') throw new ApiRequestError(0, 'ABORTED', 'Aborted')
    return undefined
  })) as unknown
  if (!res.ok) {
    const error = (json as ApiError | undefined)?.error
    throw new ApiRequestError(res.status, error?.code ?? 'INTERNAL_ERROR', error?.message ?? `HTTP ${res.status}`, error)
  }
  return json as T
}

const org = (username: string) => `/api/orgs/${encodeURIComponent(username)}`
const flag = (name: string, on: boolean | undefined) => (on ? `${name}=1` : '')
const query = (...parts: string[]) => {
  const q = parts.filter(Boolean).join('&')
  return q ? `?${q}` : ''
}

export type DescribeGlobal = WithFetchedAt<WithApiUsage<{ sobjects: SObjectSummary[] }>>
export type SObjectSummary = { name: string; label: string; queryable?: boolean; custom?: boolean }
export type DescribeSObject = WithFetchedAt<WithApiUsage<SObjectDescribe>>
export type SObjectDescribe = {
  name: string
  label: string
  fields: FieldDescribe[]
  childRelationships: ChildRelationship[]
}
export type FieldDescribe = {
  name: string
  label: string
  type: string
  relationshipName: string | null
  referenceTo: string[]
  updateable?: boolean
  /** For picklists: the values defined (the describe has more fields; only these are read). */
  picklistValues?: { value: string; active: boolean }[]
}
export type ChildRelationship = { childSObject: string; field: string; relationshipName: string | null }

export const api = {
  /** Exchanges a one-time launch code. Call once, outside React, before rendering. */
  async exchangeLaunchCode(code: string): Promise<SessionResponse> {
    const res = await request<SessionResponse>('POST', '/api/session', { code })
    setSessionToken(res.sessionToken)
    return res
  },
  orgs: (refresh = false, waitForCheck = false) =>
    request<OrgsResponse>('GET', `/api/orgs${query(flag('refresh', refresh), flag('waitForCheck', waitForCheck))}`),
  /** Checks every org's connection again (about 10 seconds or more). */
  checkConnections: () => request<OrgsResponse>('POST', '/api/orgs/check'),
  summary: (username: string) => request<WithApiUsage<OrgSummary>>('GET', `${org(username)}/summary`),
  sobjects: (username: string, tooling: boolean, refresh = false) =>
    request<DescribeGlobal>('GET', `${org(username)}/sobjects${query(flag('tooling', tooling), flag('refresh', refresh))}`),
  describe: (username: string, name: string, tooling: boolean, refresh = false) =>
    request<DescribeSObject>(
      'GET',
      `${org(username)}/sobjects/${encodeURIComponent(name)}${query(flag('tooling', tooling), flag('refresh', refresh))}`,
    ),
  query: (username: string, req: QueryRequest, signal?: AbortSignal) =>
    request<WithApiUsage<QueryResponse>>('POST', `${org(username)}/query`, req, signal),
  nextPage: (username: string, nextRecordsUrl: string, signal?: AbortSignal) =>
    request<WithApiUsage<QueryResponse>>('POST', `${org(username)}/query/next`, { nextRecordsUrl }, signal),
  history: (username: string) => request<HistoryResponse>('GET', `${org(username)}/history`),
  openOrg: (username: string) => request<{ ok: true }>('POST', `${org(username)}/open`),
  settings: () => request<Settings>('GET', '/api/settings'),
  saveSettings: (settings: SettingsUpdate) => request<Settings>('PUT', '/api/settings', settings),
  aiGenerate: <T extends AiTask>(req: AiTaskRequest & { task: T }, signal?: AbortSignal) =>
    request<{ output: AiOutput<T> }>('POST', '/api/ai/generate', req, signal),
  aiTest: (body: AiTestRequest, signal?: AbortSignal) => request<AiTestResponse>('POST', '/api/ai/test', body, signal),
}

export type { ApiUsage }
