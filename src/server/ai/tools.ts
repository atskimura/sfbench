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
type ChildJson = { childSObject: string; relationshipName: string | null }
type DescribeJson = { name: string; label: string; fields: FieldJson[]; childRelationships?: ChildJson[] }

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
      'Returns one object: its child relationships ("Name -> ChildObject"), then its fields one per line: "Name type(referenceTo) relationship Name [readonly] Label [picklist values]". A large object comes with less detail, or with names only; then use findFields for the fields you need.',
    schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The API name of the object.' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'findFields',
    description: `Finds the fields and child relationships of one object whose name, relationship name or label contains any of the keywords (case-insensitive), with labels and picklist values (at most ${MAX_PICKLIST_VALUES} values a field); exact names first, at most ${MAX_FOUND} lines.`,
    schema: {
      type: 'object',
      properties: {
        object: { type: 'string', description: 'The API name of the object.' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Field or relationship names, or words of their labels.' },
      },
      required: ['object', 'keywords'],
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

/** The most one tool result returns, so that one large object leaves room for the objects read after it. */
export const MAX_READ_BYTES = 40_000

const bytes = (text: string) => encoder.encode(text).length
const NEAR_LIMIT = 'Not returned: the limit of what the tools return is near. Answer with what you have.'

function fieldLine(f: FieldJson, name: (n: string) => string, full: boolean): string {
  const parts = [name(f.name), f.type === 'reference' && f.referenceTo?.length ? `reference(${f.referenceTo.map(name).join(',')})` : f.type]
  if (f.relationshipName) parts.push(`relationship ${name(f.relationshipName)}`)
  if (f.updateable === false && f.createable === false) parts.push('readonly')
  if (!full) return parts.join(' ')
  parts.push(f.label)
  const active = (f.picklistValues ?? []).filter((v) => v.active)
  if (active.length === 0) return parts.join(' ')
  const more = active.length > MAX_PICKLIST_VALUES ? ` (+${active.length - MAX_PICKLIST_VALUES} more)` : ''
  return `${parts.join(' ')} [${active
    .slice(0, MAX_PICKLIST_VALUES)
    .map((v) => v.value)
    .join(', ')}]${more}`
}

const childLine = (r: ChildJson, name: (n: string) => string) => `${name(r.relationshipName!)} -> ${name(r.childSObject)}`
const childrenOf = (d: DescribeJson) => (d.childRelationships ?? []).filter((r): r is ChildJson => Boolean(r.relationshipName))

/**
 * The forms of describeObject, from the most detail to the least: each names
 * every child relationship and field (docs/ai-agent.md "大きなオブジェクト").
 */
const FORMS: ((d: DescribeJson, name: (n: string) => string) => string)[] = [
  (d, name) => describeLines(d, name, true).join('\n'),
  (d, name) =>
    [`Object ${name(d.name)} (${d.label})`, '(Labels and picklist values are left out: use findFields to read the fields you need in full.)', ...describeLines(d, name, false).slice(1)].join('\n'),
  (d, name) =>
    [
      `Object ${name(d.name)} (${d.label})`,
      '(Types, labels and picklist values are left out: use findFields to read the fields and child relationships you need.)',
      `Child relationships: ${childrenOf(d)
        .map((r) => name(r.relationshipName!))
        .join(', ')}`,
      `Fields: ${d.fields.map((f) => name(f.name)).join(', ')}`,
    ].join('\n'),
]

function describeLines(d: DescribeJson, name: (n: string) => string, full: boolean): string[] {
  const lines = [`Object ${name(d.name)} (${d.label})`]
  const children = childrenOf(d)
  if (children.length) lines.push('Child relationships:', ...children.map((r) => childLine(r, name)))
  lines.push('Fields:', ...d.fields.map((f) => fieldLine(f, name, full)))
  return lines
}

/** The object in full, as the first form of describeObject. */
export function describeText(d: DescribeJson, source: Pick<MetadataSource, 'omitNamespace'> = {}): string {
  return FORMS[0](d, (n) => shown(source, n))
}

/**
 * A text cut to the budget, on a line, saying so: the last guard for a tool
 * result (the tools keep within the budget themselves).
 */
export function cutToBudget(text: string, budget: number): string {
  if (bytes(text) <= budget) return text
  const note = '\n(Cut here: the limit of what the tools return is reached. Answer with what you have.)'
  const room = Math.max(0, budget - bytes(note))
  const kept: string[] = []
  let used = 0
  for (const line of text.split('\n')) {
    const size = bytes(line) + 1
    if (used + size > room) break
    kept.push(line)
    used += size
  }
  return kept.join('\n') + note
}

/** What one request has returned: objects listed by describeObject are not listed again. */
export type ReadState = { listed: Set<string> }
export const newReadState = (): ReadState => ({ listed: new Set() })

/** An object's describe, matched in the list; undefined when the org has no such object. */
async function described(source: MetadataSource, name: string): Promise<{ object: SObjectSummary; d: DescribeJson } | undefined> {
  // Read with the list's spelling, so that one describe is not read again under another case.
  const object = await findObject(source, name)
  const d = object ? await source.describe(object.name) : undefined
  // Anything but a describe (a cache shared with other answers) is no object.
  return object && d && Array.isArray(d.fields) ? { object, d } : undefined
}

/**
 * describeObject: the form with the most detail that fits `budget` and one
 * result. Undefined when the org has no such object.
 */
export async function readObject(source: MetadataSource, name: string, budget: number, state: ReadState): Promise<string | undefined> {
  const found = await described(source, name)
  if (!found) return undefined
  const shownName = shown(source, found.object.name)
  if (state.listed.has(found.object.name)) return `${shownName} is already above in this conversation: use it, and findFields for what was left out.`
  const show = (n: string) => shown(source, n)
  // The detailed forms within one result; the names, the least the AI needs, within all the budget left.
  const rooms = [Math.min(budget, MAX_READ_BYTES), Math.min(budget, MAX_READ_BYTES), budget]
  for (const [i, form] of FORMS.entries()) {
    const text = form(found.d, show)
    if (bytes(text) > rooms[i]) continue
    state.listed.add(found.object.name)
    return text
  }
  // Too many names for any budget, with much of it left: the AI finds what it needs instead.
  if (budget < MAX_READ_BYTES) return NEAR_LIMIT
  state.listed.add(found.object.name)
  return `Object ${shownName} (${found.d.label}) has ${found.d.fields.length} fields and ${childrenOf(found.d).length} child relationships, too many to list: use findFields to find the ones you need.`
}

/**
 * findFields: the fields and child relationships whose names or labels hold a
 * keyword, in full; exact names first, within `budget` and one result.
 */
export async function findFieldsText(source: MetadataSource, objectName: string, keywords: readonly string[], budget: number): Promise<string | undefined> {
  const found = await described(source, objectName)
  if (!found) return undefined
  const words = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean)
  if (words.length === 0) return 'Give at least one keyword.'
  const name = (n: string) => shown(source, n)
  // Both the name as shown and the full name, so that either spelling finds it.
  const names = (n: string) => [n.toLowerCase(), name(n).toLowerCase()]
  const exact = (n: string) => names(n).some((x) => words.includes(x))
  const contains = (n: string, label = '') => [...names(n), label.toLowerCase()].some((x) => words.some((w) => x.includes(w)))
  // A reference is also found by its relationship name (Account__r), as SOQL follows it by that name.
  const fields = found.d.fields.filter((f) => contains(f.name, f.label) || (f.relationshipName ? contains(f.relationshipName) : false))
  const children = childrenOf(found.d).filter((r) => contains(r.relationshipName!) || contains(r.childSObject))
  const lines = [
    ...fields.filter((f) => exact(f.name)).map((f) => fieldLine(f, name, true)),
    ...children.filter((r) => exact(r.relationshipName!)).map((r) => `child relationship ${childLine(r, name)}`),
    ...fields.filter((f) => !exact(f.name)).map((f) => fieldLine(f, name, true)),
    ...children.filter((r) => !exact(r.relationshipName!)).map((r) => `child relationship ${childLine(r, name)}`),
  ]
  if (lines.length === 0) return `No field or child relationship of ${name(found.object.name)} matches.`
  const room = Math.min(budget, MAX_READ_BYTES)
  const head = `Object ${name(found.object.name)}:`
  const more = (rest: number) => `(${rest} more: use more specific keywords.)`
  const kept: string[] = []
  // Room for the longest closing note it can need.
  let used = bytes(head) + bytes(more(lines.length)) + 1
  for (const line of lines.slice(0, MAX_FOUND)) {
    if (used + bytes(line) + 1 > room) break
    kept.push(line)
    used += bytes(line) + 1
  }
  if (kept.length === 0) return NEAR_LIMIT
  const rest = lines.length - kept.length
  return [head, ...kept, ...(rest ? [more(rest)] : [])].join('\n')
}

const noObject = (name: string) => `The org has no object named ${name}. Use findObjects to look for it.`
const isName = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(v)

/** Runs one metadata tool. A call of the wrong shape is answered with what is wrong, so that the AI can try again. */
export async function runTool(source: MetadataSource, name: string, input: unknown, budget: number, state: ReadState): Promise<string> {
  const args = (input ?? {}) as Record<string, unknown>
  const isWords = (v: unknown): v is string[] => Array.isArray(v) && v.every((k) => typeof k === 'string')
  if (name === 'findObjects') {
    if (!isWords(args.keywords)) return 'keywords must be a list of strings.'
    return cutToBudget(findObjectsText(await source.objects(), args.keywords, source), Math.min(budget, MAX_READ_BYTES))
  }
  if (name === 'describeObject') {
    if (!isName(args.name)) return 'name must be an object API name.'
    return (await readObject(source, args.name, budget, state)) ?? noObject(args.name)
  }
  if (name === 'findFields') {
    if (!isName(args.object)) return 'object must be an object API name.'
    if (!isWords(args.keywords)) return 'keywords must be a list of strings.'
    return (await findFieldsText(source, args.object, args.keywords, budget)) ?? noObject(args.object)
  }
  return `There is no tool named ${name}.`
}
