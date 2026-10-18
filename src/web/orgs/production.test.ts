import { describe, expect, it } from 'vitest'
import type { Org } from '../../shared/api.ts'
import { isProductionByList, isProductionBySummary, orgKindLabel } from './production.ts'

const org = (kind: Org['kind'], edition?: string): Org => ({
  username: 'u@example.com',
  instanceUrl: 'https://x.my.salesforce.com',
  kind,
  edition,
  isExpired: false,
  availability: 'unknown',
})

describe('isProductionByList', () => {
  it.each([
    ['production', 'Enterprise Edition', true],
    ['production', 'Developer Edition', false],
    ['production', undefined, true],
    ['devhub', 'Enterprise Edition', true],
    ['sandbox', 'Enterprise Edition', false],
    ['scratch', 'Developer Edition', false],
  ] as const)('%s / %s → %s', (kind, edition, expected) => {
    expect(isProductionByList(org(kind, edition))).toBe(expected)
  })
})

describe('isProductionBySummary', () => {
  it('uses the Organization record once known', () => {
    const unknown = org('production')
    expect(isProductionBySummary(unknown, { organizationType: 'Developer Edition', isSandbox: false, namespacePrefix: null })).toBe(false)
    expect(isProductionBySummary(unknown, { organizationType: 'Enterprise Edition', isSandbox: false, namespacePrefix: null })).toBe(true)
    expect(isProductionBySummary(unknown, { organizationType: 'Enterprise Edition', isSandbox: true, namespacePrefix: null })).toBe(false)
  })

  it('falls back to the list before the summary arrives', () => {
    expect(isProductionBySummary(org('production'), undefined)).toBe(true)
  })
})

describe('orgKindLabel', () => {
  it('shows a scratch org as Scratch, though its Organization says it is a sandbox', () => {
    expect(orgKindLabel(org('scratch'), { organizationType: 'Developer Edition', isSandbox: true, namespacePrefix: null })).toBe('Scratch')
  })

  it('prefers the edition for production-like orgs', () => {
    expect(orgKindLabel(org('production', 'Developer Edition'))).toBe('Developer Edition')
    expect(orgKindLabel(org('production'))).toBe('Production')
    expect(orgKindLabel(org('sandbox', 'Enterprise Edition'))).toBe('Sandbox')
    expect(orgKindLabel(org('production'), { organizationType: 'Unlimited Edition', isSandbox: false, namespacePrefix: null })).toBe(
      'Unlimited Edition',
    )
  })
})
