// The tools the AI calls to read the org's metadata (docs/ai-agent.md "ツール",
// "SOQL のときのツール"): searching objects and listing an object's fields.
// Only metadata goes back, never record values. Names are full API names, with
// their namespace, except where SOQL may leave the org's own namespace out.
import { findByName, stripNamespace } from '../../shared/namespace.ts'
import type { ToolSpec } from './conversation.ts'

/** The most objects one search returns. */
const MAX_FOUND = 50
const MAX_PICKLIST_VALUES = 50
/** Objects that are rarely queried and would crowd a SOQL search (sharing, history, feeds, change events): listed last. */
const NOISE = /(Share|History|Feed|ChangeEvent)$/
const encoder = new TextEncoder()

type SObjectSummary = { name: string; label: string; custom?: boolean; queryable?: boolean }
type FieldJson = {
  name: string
  label: string
  type: string
  referenceTo?: string[]
  relationshipName?: string | null
  updateable?: boolean
  createable?: boolean
  picklistValues?: { value: string; active: boolean }[]
}
type DescribeJson = { name: string; label: string; fields: FieldJson[]; childRelationships?: { childSObject: string; relationshipName: string | null }[] }

/**
 * Reads the org: the object list and one object's describe, from the server's
 * cache, all from one API (Tooling or not) and one version for the request.
 */
export type MetadataSource = {
  objects: () => Promise<SObjectSummary[]>
  /** Undefined when the org has no such object. */
  describe: (name: string) => Promise<DescribeJson | undefined>
  /** For SOQL: unqueryable and noise objects are left out of searches. */
  soql?: boolean
  /** The org's namespace when names are shown without it: only when queries run with it as the default. */
  omitNamespace?: string
}

export const METADATA_TOOLS: ToolSpec[] = [
  {
    name: 'findObjects',
    description: `Finds the org's objects whose API name or label contains any of the keywords (case-insensitive). Returns "ApiName Label" lines, at most ${MAX_FOUND}; custom objects (made in this org or by a package) end with "(custom)".`,
    schema: {
      type: 'object',
      properties: { keywords: { type: 'array', items: { type: 'string' }, description: 'Words to look for, in English or the language of the labels.' } },
      required: ['keywords'],
      additionalProperties: false,
    },
  },
  {
    name: 'describeObject',
    description:
      'Returns the fields of one object, one per line: "Name type(referenceTo) relationship Name [readonly] Label [picklist values]", then its child relationships.',
    schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The API name of the object.' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
]

/** A name as the AI is shown it. */
export function shown(source: Pick<MetadataSource, 'omitNamespace'>, name: string): string {
  return source.omitNamespace ? stripNamespace(name, source.omitNamespace) : name
}

/** The object in the list that a name means, matched without regard to case or the org's namespace. */
export async function findObject(source: MetadataSource, name: string): Promise<SObjectSummary | undefined> {
  return findByName(await source.objects(), name.trim(), source.omitNamespace)
}

export function findObjectsText(objects: readonly SObjectSummary[], keywords: readonly string[], source: Pick<MetadataSource, 'soql' | 'omitNamespace'> = {}): string {
  const words = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean)
  if (words.length === 0) return 'Give at least one keyword.'
  const searched = source.soql ? objects.filter((o) => o.queryable !== false) : objects
  const matched = searched.filter((o) => words.some((w) => o.name.toLowerCase().includes(w) || o.label.toLowerCase().includes(w)))
  // Still found when asked for (LoginHistory), but after the objects usually meant.
  const found = source.soql ? [...matched.filter((o) => !NOISE.test(o.name)), ...matched.filter((o) => NOISE.test(o.name))] : matched
  if (found.length === 0) return 'No object matches.'
  const lines = found.slice(0, MAX_FOUND).map((o) => `${shown(source, o.name)} ${o.label}${o.custom ? ' (custom)' : ''}`)
  if (found.length > MAX_FOUND) lines.push(`(${found.length - MAX_FOUND} more: use more specific keywords)`)
  return lines.join('\n')
}

/**
 * How much of a field is shown: everything, then without picklist values, then
 * without labels too, so that a large object still names every field within
 * what is left of the budget (docs/ai-agent.md "ツール").
 */
const DETAILS = [
  { picklists: true, labels: true, note: '' },
  { picklists: false, labels: true, note: '(Picklist values are left out to fit the limit of what the tools return.)' },
  { picklists: false, labels: false, note: '(Labels and picklist values are left out to fit the limit of what the tools return.)' },
]

export function describeText(d: DescribeJson, source: Pick<MetadataSource, 'omitNamespace'> = {}, detail = DETAILS[0]): string {
  const name = (n: string) => shown(source, n)
  const lines = [`Object ${name(d.name)} (${d.label})`]
  if (detail.note) lines.push(detail.note)
  lines.push('Fields:')
  for (const f of d.fields) {
    const parts = [name(f.name), f.type === 'reference' && f.referenceTo?.length ? `reference(${f.referenceTo.map(name).join(',')})` : f.type]
    if (f.relationshipName) parts.push(`relationship ${name(f.relationshipName)}`)
    if (f.updateable === false && f.createable === false) parts.push('readonly')
    if (detail.labels) parts.push(f.label)
    let line = parts.join(' ')
    const values = detail.picklists ? (f.picklistValues ?? []).filter((v) => v.active).slice(0, MAX_PICKLIST_VALUES) : []
    if (values.length) line += ` [${values.map((v) => v.value).join(', ')}]`
    lines.push(line)
  }
  const children = (d.childRelationships ?? []).filter((r) => r.relationshipName)
  if (children.length) {
    lines.push('Child relationships:')
    for (const r of children) lines.push(`${name(r.relationshipName!)} -> ${name(r.childSObject)}`)
  }
  return lines.join('\n')
}

/**
 * One object's fields, with as much detail as fits `budget` (bytes); the
 * caller cuts what still does not fit. Undefined when the org has no such
 * object. `name` is the list's spelling, which tells repeated reads apart.
 */
export async function readObject(source: MetadataSource, name: string, budget = Infinity): Promise<{ name: string; text: string } | undefined> {
  // Read with the list's spelling, so that one describe is not read again under another case.
  const object = await findObject(source, name)
  const described = object ? await source.describe(object.name) : undefined
  // Anything but a describe (a cache shared with other answers) is no object.
  if (!object || !described || !Array.isArray(described.fields)) return undefined
  let text = ''
  for (const detail of DETAILS) {
    text = describeText(described, source, detail)
    if (encoder.encode(text).length <= budget) break
  }
  return { name: object.name, text }
}

const noObject = (name: string) => `The org has no object named ${name}. Use findObjects to look for it.`

/** Runs one metadata tool. A call of the wrong shape is answered with what is wrong, so that the AI can try again. */
export async function runTool(source: MetadataSource, name: string, input: unknown, budget = Infinity): Promise<string> {
  const args = (input ?? {}) as Record<string, unknown>
  if (name === 'findObjects') {
    if (!Array.isArray(args.keywords) || !args.keywords.every((k) => typeof k === 'string')) return 'keywords must be a list of strings.'
    return findObjectsText(await source.objects(), args.keywords, source)
  }
  if (name === 'describeObject') {
    if (typeof args.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(args.name)) return 'name must be an object API name.'
    return (await readObject(source, args.name, budget))?.text ?? noObject(args.name)
  }
  return `There is no tool named ${name}.`
}
