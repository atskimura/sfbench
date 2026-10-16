// The sf commands sfbench uses, other than `sf api request rest` (apiRequest.ts).
import type { Org, OrgKind } from '../../shared/api.ts'
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
    })
  }
  // Orgs with an alias first (by alias), then the rest (by username): orgs
  // without an alias are usually leftovers such as test users.
  return orgs.sort((a, b) =>
    a.alias && b.alias ? a.alias.localeCompare(b.alias) : a.alias ? -1 : b.alias ? 1 : a.username.localeCompare(b.username),
  )
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
