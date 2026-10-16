// The orgs the sf CLI knows about, and one OrgClient per org.
import type { Org, OrgSummary } from '../shared/api.ts'
import { OrgClient } from './salesforce.ts'
import { listOrgs } from './sf/commands.ts'

export type Described = { body: unknown; fetchedAt: string }

export class OrgRegistry {
  private readonly tmpDir: string
  private readonly forceCli: boolean
  private readonly timeoutMs: () => number
  private orgs: Promise<Org[]> | undefined
  private readonly clients = new Map<string, OrgClient>()
  private readonly summaries = new Map<string, Promise<OrgSummary>>()
  private readonly sobjects = new Map<string, Promise<Described>>()

  constructor(tmpDir: string, forceCli: boolean, timeoutMs: () => number) {
    this.tmpDir = tmpDir
    this.forceCli = forceCli
    this.timeoutMs = timeoutMs
  }

  /** The org list. `sf org list` can take several seconds, so the result is cached until refresh. */
  list(refresh = false): Promise<Org[]> {
    if (refresh || !this.orgs) {
      const pending = listOrgs(this.tmpDir)
      this.orgs = pending
      pending.catch(() => {
        if (this.orgs === pending) this.orgs = undefined
      })
    }
    return this.orgs
  }

  /** The client for a username from the list. Returns undefined for anything else. */
  async client(username: string): Promise<OrgClient | undefined> {
    const org = (await this.list()).find((o) => o.username === username)
    if (!org) return undefined
    let client = this.clients.get(username)
    if (!client || client.instanceUrl !== org.instanceUrl) {
      client = new OrgClient({
        username,
        instanceUrl: org.instanceUrl,
        tmpDir: this.tmpDir,
        forceCli: this.forceCli,
        timeoutMs: this.timeoutMs,
      })
      this.clients.set(username, client)
    }
    return client
  }

  /** Organization type and namespace, fetched once per org. */
  summary(client: OrgClient): Promise<OrgSummary> {
    let pending = this.summaries.get(client.username)
    if (!pending) {
      pending = fetchSummary(client)
      this.summaries.set(client.username, pending)
      pending.catch(() => this.summaries.delete(client.username))
    }
    return pending
  }

  /** A cached describe result with the time it was fetched. `key` is "global" or an sObject name. */
  cachedDescribe(client: OrgClient, key: string, refresh: boolean, load: () => Promise<unknown>): Promise<Described> {
    const cacheKey = `${client.username}\n${key}`
    let pending = this.sobjects.get(cacheKey)
    if (refresh || !pending) {
      pending = load().then((body) => ({ body, fetchedAt: new Date().toISOString() }))
      this.sobjects.set(cacheKey, pending)
      const stored = pending
      pending.catch(() => {
        if (this.sobjects.get(cacheKey) === stored) this.sobjects.delete(cacheKey)
      })
    }
    return pending
  }
}

async function fetchSummary(client: OrgClient): Promise<OrgSummary> {
  const version = await client.version()
  const soql = 'SELECT OrganizationType, IsSandbox, NamespacePrefix FROM Organization'
  const res = await client.request({ method: 'GET', path: `/services/data/v${version}/query?q=${encodeURIComponent(soql)}` })
  const record = (res.body as { records?: Record<string, unknown>[] } | undefined)?.records?.[0]
  if (!record) throw new Error('The Organization query returned no record')
  return {
    organizationType: String(record.OrganizationType ?? ''),
    isSandbox: Boolean(record.IsSandbox),
    namespacePrefix: typeof record.NamespacePrefix === 'string' && record.NamespacePrefix ? record.NamespacePrefix : null,
  }
}
