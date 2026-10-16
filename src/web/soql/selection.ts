// SOQL and the field selection in the left panel, kept in sync. The editor's
// SOQL is the source of truth; the selection is derived from it, and clicks in
// the panel rewrite the SOQL (docs/web.md "SOQL と項目の選択の同期").
import {
  composeQuery,
  getField,
  isQueryValid,
  parseQuery,
  type FieldSubquery,
  type FieldType,
  type Query,
  type Subquery,
} from 'soql-parser-js'
import { nameKey, soqlName } from './namespace.ts'

export type NameContext = {
  /** The org's namespace prefix. */
  ns: string | null | undefined
  /** The "omit the namespace" setting. */
  omitNamespace: boolean
}

/** A field in the panel: `Account.Owner.Name` is { relationships: ['Account', 'Owner'], name: 'Name' }. */
export type FieldRef = { name: string; relationships: string[] }

export type Selection = {
  /** The FROM object as written. */
  object: string
  /** Keys (namespace removed, lower case) of selected fields, such as "account.name". */
  fields: Set<string>
  /** Child relationship key → keys of the fields selected in its subquery. */
  subqueries: Map<string, Set<string>>
}

export function parseSoql(text: string): Query | undefined {
  if (!text.trim()) return undefined
  try {
    return isQueryValid(text) ? parseQuery(text) : undefined
  } catch {
    return undefined
  }
}

export function compose(query: Query): string {
  return composeQuery(query, { format: true })
}

/** Formats SOQL, or returns undefined if it cannot be parsed. */
export function formatSoql(text: string): string | undefined {
  const query = parseSoql(text)
  return query && compose(query)
}

function fieldKey(field: FieldType, ns: NameContext['ns']): string | undefined {
  switch (field.type) {
    case 'Field':
      return nameKey(field.field, ns)
    case 'FieldRelationship':
      return nameKey([...field.relationships, field.field].join('.'), ns)
    default:
      return undefined
  }
}

function keysOf(fields: FieldType[] | undefined, ns: NameContext['ns']): Set<string> {
  const keys = new Set<string>()
  for (const f of fields ?? []) {
    const key = fieldKey(f, ns)
    if (key) keys.add(key)
  }
  return keys
}

export function selectionOf(query: Query, ns: NameContext['ns']): Selection {
  const subqueries = new Map<string, Set<string>>()
  for (const f of query.fields ?? []) {
    if (f.type === 'FieldSubquery') {
      subqueries.set(nameKey(f.subquery.relationshipName, ns), keysOf(f.subquery.fields, ns))
    }
  }
  return { object: query.sObject ?? '', fields: keysOf(query.fields, ns), subqueries }
}

export function refKey(ref: FieldRef, ns: NameContext['ns']): string {
  return nameKey([...ref.relationships, ref.name].join('.'), ns)
}

function newField(ref: FieldRef, ctx: NameContext): FieldType {
  const name = soqlName(ref.name, ctx.ns, ctx.omitNamespace)
  if (ref.relationships.length === 0) return getField(name)
  return getField({ field: name, relationships: ref.relationships.map((r) => soqlName(r, ctx.ns, ctx.omitNamespace)) })
}

function toggleIn<T extends Query | Subquery>(query: T, ref: FieldRef, ctx: NameContext): T {
  const key = refKey(ref, ctx.ns)
  const fields = query.fields ?? []
  const without = fields.filter((f) => fieldKey(f, ctx.ns) !== key)
  return { ...query, fields: without.length !== fields.length ? without : [...fields, newField(ref, ctx)] }
}

/**
 * Adds the field to SELECT, or removes it if present. With `childRelationship`,
 * toggles it in that subquery, adding the subquery if needed. Returns
 * undefined when the SOQL cannot be parsed: the caller then leaves the editor
 * alone instead of overwriting what the user is typing.
 */
export function toggleField(text: string, ref: FieldRef, ctx: NameContext, childRelationship?: string): string | undefined {
  const query = parseSoql(text)
  if (!query) return undefined
  if (!childRelationship) return compose(toggleIn(query, ref, ctx))

  const relKey = nameKey(childRelationship, ctx.ns)
  const fields = query.fields ?? []
  const index = fields.findIndex((f) => f.type === 'FieldSubquery' && nameKey(f.subquery.relationshipName, ctx.ns) === relKey)
  if (index === -1) {
    const subquery: Subquery = {
      fields: [newField(ref, ctx)],
      relationshipName: soqlName(childRelationship, ctx.ns, ctx.omitNamespace),
    }
    return compose({ ...query, fields: [...fields, getField({ subquery })] })
  }
  const existing = fields[index] as FieldSubquery
  const updated: FieldSubquery = { ...existing, subquery: toggleIn(existing.subquery, ref, ctx) }
  return compose({ ...query, fields: fields.map((f, i) => (i === index ? updated : f)) })
}

/** Adds `(SELECT Id FROM <relationship>)`, or removes the subquery if present. */
export function toggleSubquery(text: string, relationshipName: string, ctx: NameContext): string | undefined {
  const query = parseSoql(text)
  if (!query) return undefined
  const relKey = nameKey(relationshipName, ctx.ns)
  const fields = query.fields ?? []
  const without = fields.filter((f) => !(f.type === 'FieldSubquery' && nameKey(f.subquery.relationshipName, ctx.ns) === relKey))
  if (without.length !== fields.length) return compose({ ...query, fields: without })
  const subquery: Subquery = {
    fields: [getField('Id')],
    relationshipName: soqlName(relationshipName, ctx.ns, ctx.omitNamespace),
  }
  return compose({ ...query, fields: [...fields, getField({ subquery })] })
}

/** Replaces SELECT with every field of the object (parent fields and subqueries are dropped, as before). */
export function selectAllFields(text: string, fieldNames: string[], ctx: NameContext): string | undefined {
  const query = parseSoql(text)
  if (!query) return undefined
  return compose({ ...query, fields: fieldNames.map((n) => getField(soqlName(n, ctx.ns, ctx.omitNamespace))) })
}

/** Replaces SELECT with Id only. */
export function clearAllFields(text: string): string | undefined {
  const query = parseSoql(text)
  if (!query) return undefined
  return compose({ ...query, fields: [getField('Id')] })
}

/** `SELECT Id FROM <object>`, written when an object is picked in the panel. */
export function initialSoql(objectName: string, ctx: NameContext): string {
  return compose({ fields: [getField('Id')], sObject: soqlName(objectName, ctx.ns, ctx.omitNamespace) })
}
