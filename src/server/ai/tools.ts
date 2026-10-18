// The tools the AI calls to read the org's metadata (docs/ai-agent.md "ツール"):
// searching objects and listing an object's fields. Only metadata goes back,
// never record values. Names are full API names, with their namespace: REST
// API and Apex cannot leave it out.
import type { ToolSpec } from './conversation.ts'

/** The most objects one search returns. */
const MAX_FOUND = 50
const MAX_PICKLIST_VALUES = 50

type SObjectSummary = { name: string; label: string }
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

/** Reads the org: the object list and one object's describe, from the server's cache. */
export type MetadataSource = {
  objects: () => Promise<SObjectSummary[]>
  /** Undefined when the org has no such object. */
  describe: (name: string) => Promise<DescribeJson | undefined>
}

export const METADATA_TOOLS: ToolSpec[] = [
  {
    name: 'findObjects',
    description: `Finds the org's objects whose API name or label contains any of the keywords (case-insensitive). Returns "ApiName Label" lines, at most ${MAX_FOUND}.`,
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

export function findObjectsText(objects: readonly SObjectSummary[], keywords: readonly string[]): string {
  const words = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean)
  if (words.length === 0) return 'Give at least one keyword.'
  const found = objects.filter((o) => words.some((w) => o.name.toLowerCase().includes(w) || o.label.toLowerCase().includes(w)))
  if (found.length === 0) return 'No object matches.'
  const lines = found.slice(0, MAX_FOUND).map((o) => `${o.name} ${o.label}`)
  if (found.length > MAX_FOUND) lines.push(`(${found.length - MAX_FOUND} more: use more specific keywords)`)
  return lines.join('\n')
}

export function describeText(d: DescribeJson): string {
  const lines = [`Object ${d.name} (${d.label})`, 'Fields:']
  for (const f of d.fields) {
    const parts = [f.name, f.type === 'reference' && f.referenceTo?.length ? `reference(${f.referenceTo.join(',')})` : f.type]
    if (f.relationshipName) parts.push(`relationship ${f.relationshipName}`)
    if (f.updateable === false && f.createable === false) parts.push('readonly')
    parts.push(f.label)
    let line = parts.join(' ')
    const values = (f.picklistValues ?? []).filter((v) => v.active).slice(0, MAX_PICKLIST_VALUES)
    if (values.length) line += ` [${values.map((v) => v.value).join(', ')}]`
    lines.push(line)
  }
  const children = (d.childRelationships ?? []).filter((r) => r.relationshipName)
  if (children.length) {
    lines.push('Child relationships:')
    for (const r of children) lines.push(`${r.relationshipName} -> ${r.childSObject}`)
  }
  return lines.join('\n')
}

/** Runs one metadata tool. A call of the wrong shape is answered with what is wrong, so that the AI can try again. */
export async function runTool(source: MetadataSource, name: string, input: unknown): Promise<string> {
  const args = (input ?? {}) as Record<string, unknown>
  if (name === 'findObjects') {
    if (!Array.isArray(args.keywords) || !args.keywords.every((k) => typeof k === 'string')) return 'keywords must be a list of strings.'
    return findObjectsText(await source.objects(), args.keywords)
  }
  if (name === 'describeObject') {
    if (typeof args.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(args.name)) return 'name must be an object API name.'
    const described = await source.describe(args.name)
    // Anything but a describe (a cache shared with other answers) is no object.
    return described && Array.isArray(described.fields) ? describeText(described) : `The org has no object named ${args.name}. Use findObjects to look for it.`
  }
  return `There is no tool named ${name}.`
}
