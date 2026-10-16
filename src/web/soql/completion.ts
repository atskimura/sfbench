// Completion candidates for the cursor's context (docs/web.md "補完"): objects
// after FROM, child relationships after FROM in a subquery, fields of the
// object (following parent relationships), and SOQL keywords.
import type { FieldDescribe, SObjectDescribe, SObjectSummary } from '../api/client.ts'
import type { CursorInfo, Scope } from './context.ts'
import { findByName, nameKey, soqlName } from './namespace.ts'
import type { NameContext } from './selection.ts'

export type Candidate = {
  /** Shown in the list: "API name / label" for fields. */
  label: string
  /** Inserted text. */
  insert: string
  kind: 'object' | 'relationship' | 'field' | 'keyword'
}

/** Where the candidates come from; the editor passes the cached describes. */
export type Describer = {
  objects: () => Promise<SObjectSummary[]>
  describe: (objectName: string) => Promise<SObjectDescribe>
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

/** Matches API name or label, ignoring case. */
export function matches(word: string, ...texts: (string | undefined)[]): boolean {
  const w = word.toLowerCase()
  return texts.some((t) => t?.toLowerCase().includes(w))
}

/**
 * Sorts by how the word matches: names that start with it, then labels that
 * start with it, then the rest, each in the original order (`Con` puts
 * Contacts before AccountContactRoles).
 */
function byRank<T>(items: T[], word: string, texts: (item: T) => (string | undefined)[]): T[] {
  const w = word.toLowerCase()
  const rank = (item: T) => {
    const i = texts(item).findIndex((t) => t?.toLowerCase().startsWith(w))
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return items
    .map((item, index) => ({ item, index, rank: rank(item) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.item)
}

export function fieldCandidates(fields: FieldDescribe[], word: string, ctx: NameContext): Candidate[] {
  return byRank(
    fields.filter((f) => matches(word, f.name, f.label)),
    word,
    (f) => [f.name, f.label],
  )
    .map((f) => {
      const insert = soqlName(f.name, ctx.ns, ctx.omitNamespace)
      return { label: `${insert} / ${f.label}`, insert, kind: 'field' as const }
    })
}

export function keywordCandidates(word: string): Candidate[] {
  return byRank(SOQL_KEYWORDS.filter((k) => matches(word, k)), word, (k) => [k]).map((k) => ({ label: k, insert: k, kind: 'keyword' as const }))
}

/** The object a scope reads: the FROM object, or the child object of its child relationship. */
async function scopeObject(scope: Scope, d: Describer, ns: NameContext['ns']): Promise<string | undefined> {
  const from = scope.from
  if (!from) return undefined
  if (scope.child) {
    const parent = scope.parent && (await scopeObject(scope.parent, d, ns))
    if (!parent) return undefined
    const rels = (await d.describe(parent)).childRelationships.flatMap((r) => (r.relationshipName ? [{ ...r, name: r.relationshipName }] : []))
    return findByName(rels, from, ns)?.childSObject
  }
  return findByName(await d.objects(), from, ns)?.name
}

/** Follows parent relationships such as Account.Owner; a polymorphic one goes to its first target, as before. */
async function followPath(object: string | undefined, path: string[], d: Describer, ns: NameContext['ns']): Promise<string | undefined> {
  for (const part of path) {
    if (!object) return undefined
    const key = nameKey(part, ns)
    const field = (await d.describe(object)).fields.find((f) => f.relationshipName && nameKey(f.relationshipName, ns) === key)
    object = field?.referenceTo[0]
  }
  return object
}

/** Candidates for the cursor. Rejects when a describe fails; the caller falls back to keywords. */
export async function contextCandidates(info: CursorInfo, d: Describer, ctx: NameContext): Promise<Candidate[]> {
  const { context, word } = info
  switch (context.kind) {
    case 'none':
      return []
    case 'keyword':
      return keywordCandidates(word)
    case 'from': {
      if (context.scope.child) {
        const parent = context.scope.parent && (await scopeObject(context.scope.parent, d, ctx.ns))
        if (!parent) return []
        const rels = (await d.describe(parent)).childRelationships.filter(
          (r): r is typeof r & { relationshipName: string } => Boolean(r.relationshipName),
        )
        return byRank(
          rels.filter((r) => matches(word, r.relationshipName, r.childSObject)),
          word,
          (r) => [r.relationshipName, r.childSObject],
        ).map((r) => {
            const insert = soqlName(r.relationshipName, ctx.ns, ctx.omitNamespace)
            return { label: `${insert} / ${r.childSObject}`, insert, kind: 'relationship' as const }
          })
      }
      return byRank(
        (await d.objects()).filter((o) => o.queryable !== false && matches(word, o.name, o.label)),
        word,
        (o) => [o.name, o.label],
      ).map((o) => {
          const insert = soqlName(o.name, ctx.ns, ctx.omitNamespace)
          return { label: `${insert} / ${o.label}`, insert, kind: 'object' as const }
        })
    }
    case 'field': {
      const object = await followPath(await scopeObject(context.scope, d, ctx.ns), context.path, d, ctx.ns)
      const fields = object ? fieldCandidates((await d.describe(object)).fields, word, ctx) : []
      // After a dot (including `a.` with the FROM alias) only fields make sense.
      return info.dotted ? fields : [...fields, ...keywordCandidates(word)]
    }
  }
}
