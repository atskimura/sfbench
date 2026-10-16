// Completion candidates as in lwc-soql-builder: the FROM object's fields and
// SOQL keywords. Context-aware candidates come in PR 2c (docs/web.md "補完").
import type { FieldDescribe } from '../apiClient.ts'
import { soqlName } from './namespace.ts'
import type { NameContext } from './selection.ts'

export type Candidate = {
  /** Shown in the list: "API name / label" for fields. */
  label: string
  /** Inserted text. */
  insert: string
  kind: 'field' | 'keyword'
}

export const SOQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'NOT IN', 'LIKE', 'INCLUDES', 'EXCLUDES', 'NULL', 'TRUE', 'FALSE',
  'ORDER BY', 'ASC', 'DESC', 'NULLS FIRST', 'NULLS LAST', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET', 'FOR VIEW', 'FOR REFERENCE',
  'FOR UPDATE', 'WITH SECURITY_ENFORCED', 'WITH USER_MODE', 'WITH SYSTEM_MODE', 'USING SCOPE', 'TYPEOF', 'WHEN', 'THEN',
  'ELSE', 'END', 'COUNT()', 'COUNT_DISTINCT()', 'SUM()', 'AVG()', 'MIN()', 'MAX()', 'FIELDS(ALL)', 'FIELDS(STANDARD)',
  'FIELDS(CUSTOM)', 'TODAY', 'YESTERDAY', 'TOMORROW', 'LAST_WEEK', 'THIS_WEEK', 'NEXT_WEEK', 'LAST_MONTH', 'THIS_MONTH',
  'NEXT_MONTH', 'LAST_90_DAYS', 'NEXT_90_DAYS', 'THIS_QUARTER', 'LAST_QUARTER', 'NEXT_QUARTER', 'THIS_YEAR', 'LAST_YEAR',
  'NEXT_YEAR', 'LAST_N_DAYS:', 'NEXT_N_DAYS:',
]

/** The FROM object of the outermost query, read without a full parse so that it works while typing. */
export function fromObjectOf(text: string): string | undefined {
  const withoutStrings = text.replace(/'(?:\\.|[^'\\])*'/g, "''")
  // Remove subqueries so that their FROM is not taken.
  let flat = withoutStrings
  for (let i = 0; i < 10 && /\([^()]*\)/.test(flat); i++) flat = flat.replace(/\([^()]*\)/g, '')
  return /\bFROM\s+([A-Za-z0-9_]+)/i.exec(flat)?.[1]
}

/** Matches API name or label, ignoring case. */
export function matches(word: string, ...texts: (string | undefined)[]): boolean {
  const w = word.toLowerCase()
  return texts.some((t) => t?.toLowerCase().includes(w))
}

export function fieldCandidates(fields: FieldDescribe[], word: string, ctx: NameContext): Candidate[] {
  return fields
    .filter((f) => matches(word, f.name, f.label))
    .map((f) => {
      const insert = soqlName(f.name, ctx.ns, ctx.omitNamespace)
      return { label: `${insert} / ${f.label}`, insert, kind: 'field' as const }
    })
}

export function keywordCandidates(word: string): Candidate[] {
  return SOQL_KEYWORDS.filter((k) => matches(word, k)).map((k) => ({ label: k, insert: k, kind: 'keyword' as const }))
}
