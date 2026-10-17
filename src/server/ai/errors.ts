// Errors from calling an AI, mapped to API error codes by the HTTP server (docs/ai.md "API").

export type AiErrorCode = 'AI_NOT_CONFIGURED' | 'AI_ERROR' | 'AI_BAD_OUTPUT' | 'AI_TIMEOUT'

export class AiError extends Error {
  readonly code: AiErrorCode
  /** What the AI sent back, for AI_BAD_OUTPUT. */
  readonly details: unknown
  constructor(code: AiErrorCode, message: string, details?: unknown) {
    super(message)
    this.code = code
    this.details = details
  }
}

/** Error text shown on screen is cut here: a proxy can answer with a whole HTML page. */
const MAX_ERROR_TEXT = 2048

export function cutErrorText(text: string): string {
  return text.length > MAX_ERROR_TEXT ? `${text.slice(0, MAX_ERROR_TEXT)}…` : text
}

/** The error message in an AI API's error body (`{error: {message}}`), or the body itself. */
export function errorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } }
    if (typeof parsed.error?.message === 'string') return cutErrorText(parsed.error.message)
  } catch {
    // Not JSON: show the text.
  }
  return cutErrorText(body.trim() || `HTTP ${status}`)
}

/** One request to a provider: the text of the reply, which tasks.ts parses and checks. */
export type ProviderRequest = {
  apiKey: string
  model: string
  system: string
  user: string
  /** The JSON Schema of the output (OpenAI strict-mode rules, docs/ai.md "出力の形"). */
  schemaName: string
  schema: object
  signal: AbortSignal
}

/** fetch with no redirects (a key must not follow a redirect elsewhere), mapping network failures. */
export async function post(url: string, headers: Record<string, string>, body: object, signal: AbortSignal): Promise<{ status: number; text: string }> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      redirect: 'error',
      signal,
    })
  } catch (e) {
    if (signal.aborted) throw signal.reason
    throw new AiError('AI_ERROR', `Could not reach ${new URL(url).host}: ${(e as Error).message}`)
  }
  return { status: res.status, text: await res.text() }
}
