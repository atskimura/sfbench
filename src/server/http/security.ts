// Request checks for the local server. See docs/design.md ("要求の検証").
import type { IncomingHttpHeaders } from 'node:http'

export const DEV_WEB_HOST = 'localhost:5173'

/** Hosts the server answers to. Anything else is rejected (DNS rebinding). */
export function allowedHosts(port: number, dev: boolean): string[] {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]
  if (dev) hosts.push(DEV_WEB_HOST)
  return hosts
}

export function isAllowedHost(host: string | undefined, port: number, dev: boolean): boolean {
  return host !== undefined && allowedHosts(port, dev).includes(host.toLowerCase())
}

/**
 * Admin endpoints are called by the CLI entry point with Node's fetch, which
 * sends no Origin. Browsers always send Origin on these POSTs, so any Origin
 * means the request came from a web page and is rejected.
 */
export function isAdminRequestOrigin(headers: IncomingHttpHeaders): boolean {
  return headers.origin === undefined
}

/**
 * Same-origin check for endpoints the web UI calls. Browsers omit Origin on
 * same-origin GET requests, so a missing Origin is not a rejection by itself:
 * the session token in a custom header already forces a CORS preflight for
 * cross-origin requests, and the server never approves one.
 */
export function isSameOriginRequest(headers: IncomingHttpHeaders): boolean {
  const host = headers.host?.toLowerCase()
  if (!host) return false
  const origin = headers.origin
  if (origin !== undefined && origin.toLowerCase() !== `http://${host}`) return false
  const site = headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin') return false
  return true
}
