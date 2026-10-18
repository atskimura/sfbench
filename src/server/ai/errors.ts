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

/**
 * Hides keys in error text: OpenAI quotes part of a wrong key
 * ("Incorrect API key provided: sk-proj-****abcd"), and keys are never shown
 * on screen.
 */
export function hideKeys(text: string): string {
  return text.replace(/\bsk-[\w*.-]+/g, 'sk-…')
}

/**
 * The error message in an AI API's error body (`{error: {type, message}}`),
 * or the body itself. The type comes first: a bare "model: x" from Anthropic
 * says little without "not_found_error".
 */
export function errorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown; type?: unknown } }
    const { message, type } = parsed.error ?? {}
    if (typeof message === 'string') return cutErrorText(hideKeys(typeof type === 'string' && type ? `${type}: ${message}` : message))
  } catch {
    // Not JSON: show the text.
  }
  return cutErrorText(hideKeys(body.trim()) || `HTTP ${status}`)
}

/**
 * POSTs JSON with no redirects (a key must not follow a redirect elsewhere)
 * and returns the parsed reply. Network failures, error statuses and replies
 * that are not JSON become AiError.
 */
export async function postJson(url: string, headers: Record<string, string>, body: object, signal: AbortSignal): Promise<unknown> {
  const { status, text } = await post(url, headers, body, signal)
  if (status < 200 || status >= 300) throw new AiError('AI_ERROR', errorMessage(status, text))
  try {
    return JSON.parse(text)
  } catch {
    throw new AiError('AI_BAD_OUTPUT', 'The AI API returned a response that is not JSON.', cutErrorText(text))
  }
}

async function post(url: string, headers: Record<string, string>, body: object, signal: AbortSignal): Promise<{ status: number; text: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      redirect: 'error',
      signal,
    })
    // Read here too: the connection can drop while the body arrives.
    return { status: res.status, text: await res.text() }
  } catch (e) {
    if (signal.aborted) throw signal.reason
    throw new AiError('AI_ERROR', `Could not reach ${new URL(url).host}: ${(e as Error).message}`)
  }
}
