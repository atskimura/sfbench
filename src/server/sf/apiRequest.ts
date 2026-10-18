// `sf api request rest`, the fallback transport. One of the documented
// exceptions to "depend only on sf's JSON output": with --include, sf prints a
// status line, headers and the body as plain text. All of that parsing lives
// here, tested against recorded output in __fixtures__.
import { randomBytes } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { OrgAuthError, SfCliError, isAuthErrorMessage } from './errors.ts'
import { lastErrorLine, runSf } from './run.ts'

export type RawResponse = {
  status: number
  /** Header names in lower case. */
  headers: Record<string, string>
  body: string
  /** The size of the body in bytes, when it was measured. */
  size?: number
  /** The body was longer than asked for, and is empty. */
  truncated?: boolean
  /** The status and headers came, but the body stopped arriving; the body is empty. */
  incomplete?: boolean
}

export type ApiRequest = {
  method: string
  /** Absolute path on the instance, such as /services/data/v62.0/query?q=... */
  path: string
  headers: Record<string, string>
  body?: string
}

/** Salesforce says the session (the access token) is invalid: a 401 with INVALID_SESSION_ID. */
export function isInvalidSession(res: Pick<RawResponse, 'status' | 'body'>): boolean {
  if (res.status !== 401) return false
  // XML when the request asked for it (Accept: application/xml).
  if (/<errorCode>\s*INVALID_SESSION_ID\s*<\/errorCode>/.test(res.body)) return true
  try {
    const body = JSON.parse(res.body) as unknown
    return Array.isArray(body) && body.some((e) => (e as { errorCode?: unknown })?.errorCode === 'INVALID_SESSION_ID')
  } catch {
    return false
  }
}

/**
 * A body that `sf api request rest` cannot send as it is: sf reads the request
 * file as JSON and sends JSON.stringify of it, so only JSON goes through, and a
 * number with more digits than a double holds would arrive rounded.
 */
export class NotJsonBodyError extends Error {
  constructor(reason: 'notJson' | 'longNumber') {
    super(
      reason === 'notJson'
        ? 'Only a JSON body can be sent while sfbench uses sf api request rest. Try again once Salesforce can be reached directly.'
        : 'A number with more than 15 digits would be rounded while sfbench uses sf api request rest, so the request was not sent. Write it as text, or try again once Salesforce can be reached directly.',
    )
    this.name = 'NotJsonBodyError'
  }
}

/** More than 15 significant digits: a double may not hold the number as written. */
function hasLongNumber(source: string): boolean {
  const mantissa = source.replace(/^-/, '').replace(/[eE].*$/, '').replace('.', '')
  return mantissa.replace(/^0+/, '').replace(/0+$/, '').length > 15
}

/** The body as sf will send it, or an error when sf would change it. */
function bodyForSf(body: string): unknown {
  let long = false
  let parsed: unknown
  try {
    // The reviver's third argument (the source text) tells the number as written.
    parsed = JSON.parse(body, function (this: unknown, _key: string, value: unknown, context?: { source?: string }) {
      if (typeof value === 'number' && context?.source && hasLongNumber(context.source)) long = true
      return value
    } as (this: unknown, key: string, value: unknown) => unknown)
  } catch {
    throw new NotJsonBodyError('notJson')
  }
  if (long) throw new NotJsonBodyError('longNumber')
  return parsed
}

const HEADER_LINE = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]?(.*)$/

/**
 * Parses the output of `sf api request rest --include`. sf prints no blank
 * line between the headers and the body, so the body starts at the first line
 * that is not a header. A plain-text body whose first line looks like a header
 * would be misread; Salesforce REST responses are JSON, so this does not occur.
 */
export function parseIncludedResponse(stdout: string): RawResponse | undefined {
  // Strip ANSI color codes in case sf colors its output despite NO_COLOR.
  // oxlint-disable-next-line no-control-regex
  const lines = stdout.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)
  const statusMatch = /^HTTP\/[\d.]+ (\d{3})\b/.exec(lines[0] ?? '')
  if (!statusMatch) return undefined
  const headers: Record<string, string> = {}
  let i = 1
  for (; i < lines.length; i++) {
    const m = HEADER_LINE.exec(lines[i])
    if (!m) break
    headers[m[1].toLowerCase()] = m[2].trim()
  }
  // Skip a blank separator line in case a future sf version prints one.
  if (lines[i] === '') i++
  return { status: Number(statusMatch[1]), headers, body: lines.slice(i).join('\n').trimEnd() }
}

/** Sends a REST request through `sf api request rest`. Throws OrgAuthError when the org's auth is no longer valid. */
export async function apiRequest(
  username: string,
  request: ApiRequest,
  tmpDir: string,
  timeoutMs: number,
): Promise<RawResponse> {
  // The request goes in a file so that user input never appears on the command line.
  const fileName = `req-${randomBytes(8).toString('hex')}.json`
  const filePath = join(tmpDir, fileName)
  // sf sends JSON.stringify(raw), so the body goes in parsed: a string here
  // would arrive quoted. Without a body, raw is left out and nothing is sent.
  const raw = request.body !== undefined ? bodyForSf(request.body) : undefined
  const fileBody = {
    url: request.path,
    method: request.method,
    header: Object.entries(request.headers).map(([key, value]) => ({ key, value })),
    body: { mode: 'raw', raw },
  }
  writeFileSync(filePath, JSON.stringify(fileBody), { mode: 0o600 })
  try {
    const { stdout, stderr } = await runSf(['api', 'request', 'rest', '--file', fileName, '--include'], {
      targetOrg: username,
      cwd: tmpDir,
      timeoutMs,
    })
    const response = parseIncludedResponse(stdout)
    if (response) {
      // sf refreshes the token itself, so an invalid session here needs a new login.
      if (isInvalidSession(response)) throw new OrgAuthError(username, 'Salesforce rejected the session (401).')
      return response
    }
    const message = lastErrorLine(stderr) ?? 'sf api request rest returned no response'
    if (isAuthErrorMessage(message)) throw new OrgAuthError(username, message)
    throw new SfCliError(message)
  } finally {
    rmSync(filePath, { force: true })
  }
}
