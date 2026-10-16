import { describe, expect, it } from 'vitest'
import { toOrgs } from './commands.ts'

describe('toOrgs', () => {
  const result = {
    nonScratchOrgs: [
      {
        username: 'admin@demo.example.com',
        alias: 'demo',
        instanceUrl: 'https://demo.my.salesforce.com',
        accessToken: '00D000000000001!secret',
        isSandbox: false,
        isScratch: false,
        isDevHub: false,
        orgEdition: 'Developer Edition',
      },
      {
        username: 'admin@acme.example.com.dev1',
        alias: 'acme-dev1',
        instanceUrl: 'https://acme--dev1.sandbox.my.salesforce.com',
        accessToken: '00D000000000002!secret',
        isSandbox: true,
      },
      { username: 'hub@acme.example.com', instanceUrl: 'https://acme.my.salesforce.com', isDevHub: true },
      { username: 'broken@example.com' },
    ],
    scratchOrgs: [
      {
        username: 'test-abc@example.com',
        alias: 'feature-1',
        instanceUrl: 'https://flow-ruby-1234.scratch.my.salesforce.com',
        accessToken: '00D000000000003!secret',
        isScratch: true,
        isSandbox: false,
        expirationDate: '2026-10-22',
        isExpired: false,
      },
      // sf lists a scratch org that is also a non-scratch org's username only once.
      { username: 'admin@demo.example.com', instanceUrl: 'https://other.example.com', isScratch: true },
    ],
  }

  it('never copies access tokens', () => {
    expect(JSON.stringify(toOrgs(result))).not.toContain('secret')
  })

  it('maps kinds, editions and scratch expiration, sorted by alias or username', () => {
    expect(toOrgs(result)).toEqual([
      {
        username: 'admin@acme.example.com.dev1',
        alias: 'acme-dev1',
        instanceUrl: 'https://acme--dev1.sandbox.my.salesforce.com',
        kind: 'sandbox',
        edition: undefined,
        expirationDate: undefined,
        isExpired: false,
      },
      {
        username: 'admin@demo.example.com',
        alias: 'demo',
        instanceUrl: 'https://demo.my.salesforce.com',
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
        edition: undefined,
        expirationDate: '2026-10-22',
        isExpired: false,
      },
      {
        username: 'hub@acme.example.com',
        alias: undefined,
        instanceUrl: 'https://acme.my.salesforce.com',
        kind: 'devhub',
        edition: undefined,
        expirationDate: undefined,
        isExpired: false,
      },
    ])
  })
})
