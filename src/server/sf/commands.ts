// The sf commands sfbench uses, other than `sf api request rest` (apiRequest.ts).
import type { Org, OrgKind } from '../../shared/api.ts'
import { SfCliError } from './errors.ts'
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
  return orgs.sort((a, b) => (a.alias ?? a.username).localeCompare(b.alias ?? b.username))
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
  const result = await runSfJson<{ accessToken?: string }>(
    ['org', 'auth', 'show-access-token', '--no-prompt'],
    { targetOrg: username, cwd },
  )
  // A real token has the form "<org id>!<secret>"; anything else means sf masked it.
  if (!result.accessToken || !result.accessToken.includes('!')) {
    throw new SfCliError('sf did not return a usable access token')
  }
  return result.accessToken
}

/** Opens a record in the default browser, logged in, with `sf org open`. */
export async function openRecord(username: string, recordId: string, cwd: string): Promise<void> {
  if (!/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(recordId)) throw new SfCliError('Invalid record ID')
  const { exitCode, stderr } = await runSf(['org', 'open', '--path', `/${recordId}`], { targetOrg: username, cwd })
  // stderr can contain the frontdoor URL, which carries a session; lastErrorLine removes URLs.
  if (exitCode !== 0) throw new SfCliError(`sf org open failed: ${lastErrorLine(stderr) ?? 'unknown error'}`)
}
