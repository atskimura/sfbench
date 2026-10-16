// The sf commands sfbench uses, other than `sf api request rest` (apiRequest.ts).
import type { Org, OrgAvailability, OrgKind } from '../../shared/api.ts'
import { OrgAuthError, SfCliError, isAuthErrorMessage } from './errors.ts'
import { lastErrorLine, runSf, runSfJson } from './run.ts'

type RawOrg = {
  username?: string
  alias?: string
  instanceUrl?: string
  isSandbox?: boolean
  isScratch?: boolean
  isDevHub?: boolean
  orgEdition?: string
  edition?: string
  expirationDate?: string
  isExpired?: boolean
  /** Scratch orgs: "Active", "Deleted", ... */
  status?: string
  /** Only without --skip-connection-status: "Connected" or an error message. */
  connectedStatus?: string
}

type OrgListResult = {
  nonScratchOrgs?: RawOrg[]
  scratchOrgs?: RawOrg[]
}

function kindOf(o: RawOrg): OrgKind {
  if (o.isScratch) return 'scratch'
  if (o.isSandbox) return 'sandbox'
  if (o.isDevHub) return 'devhub'
  return 'production'
}

/**
 * Converts `sf org list --json` output to Org objects. Only the fields the UI
 * needs are copied: sf's output also contains each org's access token, which
 * must never reach the browser.
 */
export function toOrgs(result: OrgListResult): Org[] {
  const seen = new Set<string>()
  const orgs: Org[] = []
  for (const o of [...(result.nonScratchOrgs ?? []), ...(result.scratchOrgs ?? [])]) {
    if (!o.username || !o.instanceUrl || seen.has(o.username)) continue
    seen.add(o.username)
    orgs.push({
      username: o.username,
      alias: o.alias || undefined,
      instanceUrl: o.instanceUrl,
      kind: kindOf(o),
      edition: o.orgEdition || o.edition || undefined,
      expirationDate: o.isScratch ? o.expirationDate : undefined,
      isExpired: Boolean(o.isExpired),
      availability: scratchAvailability(o),
    })
  }
  // Orgs with an alias first (by alias), then the rest (by username): orgs
  // without an alias are usually leftovers such as test users.
  return orgs.sort((a, b) =>
    a.alias && b.alias ? a.alias.localeCompare(b.alias) : a.alias ? -1 : b.alias ? 1 : a.username.localeCompare(b.username),
  )
}

/**
 * Scratch orgs carry their state, recorded by the Dev Hub, even in the fast
 * list. The sf CLI does not check their connection, so an active scratch org
 * within its expiration date is treated as usable. Other orgs need the
 * connection check.
 */
function scratchAvailability(o: RawOrg): OrgAvailability {
  if (!o.isScratch) return 'unknown'
  if (o.isExpired || (o.status !== undefined && o.status !== 'Active')) return 'unavailable'
  return o.status === 'Active' ? 'ok' : 'unknown'
}

/** The command that logs in to an org again. */
export function reloginCommand(org: Pick<Org, 'instanceUrl' | 'alias'>): string {
  return `sf org login web --instance-url ${org.instanceUrl}${org.alias ? ` -a ${org.alias}` : ''}`
}

// `sf org list` reports a deleted org or an expired trial as an HTML response with HTTP 420.
const GONE_PATTERNS = [/HTTP status code: 420/, /HTTP response contains html content/i]

/**
 * Reads `connectedStatus`. Only clear signals hide an org: a network problem
 * while checking (for example, being offline) must not hide every org.
 */
export function availabilityFromStatus(connectedStatus: string | undefined): OrgAvailability {
  if (!connectedStatus) return 'unknown'
  if (connectedStatus === 'Connected') return 'ok'
  if (isAuthErrorMessage(connectedStatus)) return 'authError'
  if (GONE_PATTERNS.some((p) => p.test(connectedStatus))) return 'unavailable'
  return 'unknown'
}

/** Maps username → availability from `sf org list --json` with connection status. */
export function toAvailability(result: OrgListResult): Map<string, OrgAvailability> {
  const map = new Map<string, OrgAvailability>()
  for (const o of result.nonScratchOrgs ?? []) {
    if (o.username) map.set(o.username, availabilityFromStatus(o.connectedStatus))
  }
  return map
}

/**
 * Checks every org's connection. Slow (about 12 seconds with 50 orgs) and
 * calls each org's API, so it runs once at startup and when the user asks.
 */
export async function checkOrgConnections(cwd: string): Promise<Map<string, OrgAvailability>> {
  const result = await runSfJson<OrgListResult>(['org', 'list'], { cwd, timeoutMs: 300_000 })
  return toAvailability(result)
}

export async function listOrgs(cwd: string): Promise<Org[]> {
  // --skip-connection-status: checking every org's connection takes far too long.
  const result = await runSfJson<OrgListResult>(['org', 'list', '--skip-connection-status'], {
    cwd,
    timeoutMs: 120_000,
  })
  return toOrgs(result)
}

/**
 * The default org (alias or username) as configured for `cwd`. The CLI entry
 * point runs this in the user's working directory, because projects can set
 * their own default org.
 */
export async function getDefaultOrg(cwd: string): Promise<string | undefined> {
  return parseDefaultOrg(await runSfJson<unknown>(['config', 'get', 'target-org'], { cwd }))
}

/** Reads the `result` of `sf config get target-org --json`. There is no `value` when no default org is set. */
export function parseDefaultOrg(result: unknown): string | undefined {
  const value = Array.isArray(result) ? (result[0] as { value?: unknown } | undefined)?.value : undefined
  return typeof value === 'string' && value ? value : undefined
}

/**
 * The org's access token. sf refreshes an expired access token before returning
 * it. When the refresh token itself is no longer valid, sf returns the stale
 * access token without an error; the caller notices through a 401.
 */
export async function getAccessToken(username: string, cwd: string): Promise<string> {
  const result = await runSfJson<unknown>(['org', 'auth', 'show-access-token', '--no-prompt'], {
    targetOrg: username,
    cwd,
  })
  return parseAccessToken(result)
}

/** Reads the `result` of `sf org auth show-access-token --json`. */
export function parseAccessToken(result: unknown): string {
  const token = (result as { accessToken?: unknown } | undefined)?.accessToken
  // A real token has the form "<org id>!<secret>"; anything else means sf masked it.
  if (typeof token !== 'string' || !token.includes('!')) {
    throw new SfCliError('sf did not return a usable access token')
  }
  return token
}

/** Opens the org's home page in the default browser, logged in, with `sf org open`. */
export async function openOrg(username: string, cwd: string): Promise<void> {
  // stdout contains the frontdoor URL, which carries a session: it is never read or logged.
  const { exitCode, stderr } = await runSf(['org', 'open'], { targetOrg: username, cwd })
  // stderr can contain the frontdoor URL, which carries a session; lastErrorLine removes URLs.
  if (exitCode !== 0) {
    const message = lastErrorLine(stderr) ?? 'unknown error'
    if (isAuthErrorMessage(message)) throw new OrgAuthError(username, message)
    throw new SfCliError(`sf org open failed: ${message}`)
  }
}
