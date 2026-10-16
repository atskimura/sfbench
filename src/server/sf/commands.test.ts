import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAccessToken, parseDefaultOrg, toOrgs } from './commands.ts'
import { SfCliError } from './errors.ts'
import { parseSfJsonOutput, redactUrls } from './run.ts'

const fixture = (name: string) =>
  (JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf8')) as { result: never }).result

describe('toOrgs with recorded `sf org list --skip-connection-status --json` output', () => {
  const orgs = toOrgs(fixture('org-list.json'))

  it('never copies access tokens', () => {
    expect(JSON.stringify(orgs)).not.toContain('REDACTED')
  })

  it('lists each org once with its kind, edition and scratch expiration', () => {
    expect(orgs).toEqual([
      {
        username: 'admin@acme.example.com.dev1',
        alias: 'acme-dev1',
        instanceUrl: 'https://acme--dev1.sandbox.my.salesforce.com',
        kind: 'sandbox',
        edition: 'Enterprise Edition',
        expirationDate: undefined,
        isExpired: false,
      },
      {
        username: 'hub@example.com',
        alias: 'acme-hub',
        instanceUrl: 'https://acme.my.salesforce.com',
        kind: 'devhub',
        edition: 'Enterprise Edition',
        expirationDate: undefined,
        isExpired: false,
      },
      {
        username: 'admin@demo.example.com',
        alias: 'demo',
        instanceUrl: 'https://demo-dev-ed.my.salesforce.com',
        kind: 'production',
        edition: 'Developer Edition',
        expirationDate: undefined,
        isExpired: false,
      },
      {
        username: 'test-abc@example.com',
        alias: 'feature-1',
        instanceUrl: 'https://flow-ruby-1234.scratch.my.salesforce.com',
        kind: 'scratch',
        edition: 'Developer Edition',
        expirationDate: '2026-11-12',
        isExpired: false,
      },
    ])
  })
})

describe('toOrgs edge cases', () => {
  it('skips entries without a username or instance URL and lists a username once', () => {
    const orgs = toOrgs({
      nonScratchOrgs: [
        { username: 'a@example.com', instanceUrl: 'https://a.my.salesforce.com' },
        { username: 'broken@example.com' },
      ],
      scratchOrgs: [{ username: 'a@example.com', instanceUrl: 'https://other.example.com', isScratch: true }],
    })
    expect(orgs.map((o) => [o.username, o.instanceUrl])).toEqual([['a@example.com', 'https://a.my.salesforce.com']])
  })
})

describe('parseDefaultOrg with recorded `sf config get target-org --json` output', () => {
  it('returns the configured alias', () => {
    expect(parseDefaultOrg(fixture('config-get-target-org-set.json'))).toBe('demo')
  })

  it('returns undefined when no default org is set', () => {
    expect(parseDefaultOrg(fixture('config-get-target-org-unset.json'))).toBeUndefined()
  })
})

describe('redactUrls', () => {
  it('removes URLs, which can carry a session', () => {
    expect(redactUrls('Failed to open https://x.my.salesforce.com/secur/frontdoor.jsp?sid=00D!abc in a browser')).toBe(
      'Failed to open <URL> in a browser',
    )
  })
})

describe('parseAccessToken with recorded `sf org auth show-access-token --json` output', () => {
  it('returns the token', () => {
    expect(parseAccessToken(fixture('show-access-token.json'))).toBe('00D000000000000AAA!FAKE.TOKEN.FOR.TESTS')
  })

  it('rejects a masked token', () => {
    expect(() => parseAccessToken({ accessToken: '[REDACTED]' })).toThrow('usable access token')
  })
})

describe('parseSfJsonOutput with a recorded sf error', () => {
  it("throws with sf's name and message", () => {
    const stdout = readFileSync(join(import.meta.dirname, '__fixtures__', 'sf-error-no-default-env.json'), 'utf8')
    try {
      parseSfJsonOutput({ stdout, stderr: '', exitCode: 1 }, 'sf org auth')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(SfCliError)
      expect((e as SfCliError).sfName).toBe('NoDefaultEnvError')
      expect((e as SfCliError).message).toMatch(/^No default environment found/)
    }
  })

  it('falls back to stderr when stdout is not JSON', () => {
    expect(() =>
      parseSfJsonOutput({ stdout: '', stderr: 'Error (1): Something broke at /services/data/v66.0/query?q=SELECT', exitCode: 1 }, 'sf x'),
    ).toThrow('Something broke at <PATH>')
  })
})
