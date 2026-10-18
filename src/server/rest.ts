// The REST API screen's requests (docs/rest.md "サーバーの `/rest`"): what is
// accepted, and how Salesforce's answer is passed back. The only place that
// decides which headers may be sent.
import { validateHeaderName, validateHeaderValue } from 'node:http'
import { isServicesPath, methodTakesBody, REST_METHODS, type LaunchOptions, type RestMethod, type RestRequest } from '../shared/api.ts'
import type { RawResponse } from './sf/apiRequest.ts'

export class RestRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RestRequestError'
  }
}

const MAX_PATH = 16 * 1024
const MAX_HEADERS = 50
const MAX_HEADER_BYTES = 16 * 1024
/** A longer response body is not passed back (bodyOmitted: 'tooLarge'). */
export const MAX_REST_RESPONSE_BYTES = 20 * 1024 * 1024

/** Names the request may not set: the token, the connection, and what fetch decides itself. */
const FORBIDDEN = new Set(['authorization', 'cookie', 'host', 'content-length', 'connection', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'keep-alive', 'expect'])

/** Checks a request from the screen. Header names come back in lower case. */
export function checkRestRequest(input: unknown): Required<Pick<RestRequest, 'method' | 'path' | 'headers'>> & Pick<RestRequest, 'body'> {
  if (!input || typeof input !== 'object') throw new RestRequestError('The body must be an object.')
  const { method, path, headers, body } = input as Record<string, unknown>
  if (typeof method !== 'string' || !(REST_METHODS as readonly string[]).includes(method)) {
    throw new RestRequestError(`method must be one of ${REST_METHODS.join(', ')}.`)
  }
  const m = method as RestMethod
  if (typeof path !== 'string' || !path) throw new RestRequestError('path is required.')
  if (path.length > MAX_PATH) throw new RestRequestError('path is too long.')
  if (body !== undefined && typeof body !== 'string') throw new RestRequestError('body must be a string.')
  // fetch cannot send a GET with a body, and would take that for a network error (docs/rest.md "前提にする事実").
  if (body !== undefined && !methodTakesBody(m)) throw new RestRequestError(`A ${m} request has no body.`)
  return { method: m, path, headers: checkHeaders(headers), body }
}

function checkHeaders(input: unknown): Record<string, string> {
  if (input === undefined) return {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RestRequestError('headers must be an object.')
  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length > MAX_HEADERS) throw new RestRequestError(`At most ${MAX_HEADERS} headers can be sent.`)
  let bytes = 0
  const headers: Record<string, string> = {}
  for (const [rawName, value] of entries) {
    if (typeof value !== 'string') throw new RestRequestError(`The value of ${rawName} must be a string.`)
    try {
      validateHeaderName(rawName)
      validateHeaderValue(rawName, value)
    } catch {
      throw new RestRequestError(`Invalid header: ${rawName}`)
    }
    const name = rawName.toLowerCase()
    if (FORBIDDEN.has(name) || name.startsWith('proxy-')) throw new RestRequestError(`The ${rawName} header cannot be set.`)
    bytes += name.length + value.length
    headers[name] = value
  }
  if (bytes > MAX_HEADER_BYTES) throw new RestRequestError('The headers are too long.')
  return headers
}

const TEXT_TYPE = /^(application\/(json|xml|[\w.+-]*\+(json|xml)|x-www-form-urlencoded|javascript)|text\/)/i

/** Salesforce's answer as the screen gets it: no set-cookie, and no body that is binary or too long. */
export function restResponseBody(raw: RawResponse): { headers: Record<string, string>; body: string; bodyOmitted?: 'binary' | 'tooLarge'; size: number } {
  const { 'set-cookie': _, ...headers } = raw.headers
  const size = raw.size ?? Buffer.byteLength(raw.body)
  if (raw.truncated) return { headers, body: '', bodyOmitted: 'tooLarge', size }
  const type = headers['content-type']
  if (raw.body && type && !TEXT_TYPE.test(type)) return { headers, body: '', bodyOmitted: 'binary', size }
  return { headers, body: raw.body, size }
}

/** The longest REST body the command line may give (docs/rest.md "`--rest` の起動時の指定"). */
const MAX_LAUNCH_BODY = 1024 * 1024

/**
 * The REST request given on the command line (`--rest <path> --method <method>
 * --body <json>`), checked. Used by the CLI and by /api/launch, which both
 * refuse what this refuses.
 */
export function restLaunch(input: { path: unknown; method?: unknown; body?: unknown }): NonNullable<LaunchOptions['rest']> {
  const method = typeof input.method === 'string' ? input.method.toUpperCase() : input.method === undefined ? 'GET' : undefined
  if (!method || !(REST_METHODS as readonly string[]).includes(method)) throw new RestRequestError(`--method must be one of ${REST_METHODS.join(', ')}.`)
  const m = method as RestMethod
  if (typeof input.path !== 'string' || !isServicesPath(input.path)) throw new RestRequestError('--rest needs a path that starts with /services/.')
  if (input.path.length > MAX_PATH) throw new RestRequestError('The --rest path is too long.')
  if (input.body === undefined) return { method: m, path: input.path }
  if (typeof input.body !== 'string') throw new RestRequestError('--body must be text.')
  if (!methodTakesBody(m)) throw new RestRequestError(`A ${m} request has no body.`)
  if (Buffer.byteLength(input.body) > MAX_LAUNCH_BODY) throw new RestRequestError('The --body is too long.')
  try {
    JSON.parse(input.body)
  } catch {
    throw new RestRequestError('--body must be JSON.')
  }
  return { method: m, path: input.path, body: input.body }
}
