// Whether an org is a production org. See docs/screens.md ("本番の組織を選んでいるとき").
import type { Org, OrgSummary } from '../../shared/api.ts'

const DEVELOPER_EDITION = /developer edition/i

/**
 * From the org list alone. Developer Edition orgs are not production. When the
 * edition is unknown, the org is treated as production, to err on the safe side.
 */
export function isProductionByList(org: Org): boolean {
  if (org.kind === 'sandbox' || org.kind === 'scratch') return false
  if (org.edition && DEVELOPER_EDITION.test(org.edition)) return false
  return true
}

/** After the org is selected and its Organization record is known. */
export function isProductionBySummary(org: Org, summary: OrgSummary | undefined): boolean {
  if (!summary) return isProductionByList(org)
  if (summary.isSandbox || org.kind === 'scratch') return false
  return !DEVELOPER_EDITION.test(summary.organizationType)
}

/** The label shown for the org's kind: the edition when known, otherwise the kind. */
export function orgKindLabel(org: Org, summary?: OrgSummary): string {
  // A scratch org reports IsSandbox as true: the org list tells it apart.
  if (org.kind === 'scratch') return kindLabel(org)
  if (summary) return summary.isSandbox ? 'Sandbox' : summary.organizationType || kindLabel(org)
  if (org.kind === 'sandbox' || org.kind === 'devhub') return kindLabel(org)
  return org.edition ?? kindLabel(org)
}

function kindLabel(org: Org): string {
  switch (org.kind) {
    case 'sandbox':
      return 'Sandbox'
    case 'scratch':
      return 'Scratch'
    case 'devhub':
      return 'Dev Hub'
    default:
      return 'Production'
  }
}
