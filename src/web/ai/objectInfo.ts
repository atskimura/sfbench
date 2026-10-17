// What the AI is told about the org's objects (docs/ai.md "タスク", "送る量"):
// one line per field, names written the way SOQL is written in the editor.
import type { SObjectDescribe, SObjectSummary } from '../apiClient.ts'
import { soqlName } from '../soql/namespace.ts'
import type { NameContext } from '../soql/selection.ts'

/** The most sent to the AI at once: about 30,000 tokens. */
export const AI_BUDGET_BYTES = 100_000
const MAX_PICKLIST_VALUES = 50
/** Objects that are rarely queried and would crowd the list (sharing, history, feeds, change events). */
const NOISE = /(Share|History|Feed|ChangeEvent)$/

const bytes = (text: string) => new TextEncoder().encode(text).length

/**
 * How much detail is kept, from all of it down to API names only. Each step
 * drops one kind of detail, in the order of docs/ai.md.
 */
type Detail = { picklists: boolean; labels: boolean; children: boolean; types: boolean }
const DETAILS: Detail[] = [
  { picklists: true, labels: true, children: true, types: true },
  { picklists: false, labels: true, children: true, types: true },
  { picklists: false, labels: false, children: true, types: true },
  { picklists: false, labels: false, children: false, types: true },
  { picklists: false, labels: false, children: false, types: false },
]

function describeText(d: SObjectDescribe, names: NameContext, detail: Detail): string {
  const name = (n: string) => soqlName(n, names.ns, names.omitNamespace)
  const lines = [`Object ${name(d.name)}${detail.labels ? ` (${d.label})` : ''}`, 'Fields:']
  for (const f of d.fields) {
    const parts = [name(f.name)]
    if (detail.types) {
      parts.push(f.type === 'reference' && f.referenceTo.length ? `reference(${f.referenceTo.map(name).join(',')})` : f.type)
      if (f.relationshipName) parts.push(`relationship ${name(f.relationshipName)}`)
    }
    if (detail.labels) parts.push(f.label)
    let line = parts.join(' ')
    if (detail.picklists && f.picklistValues?.length) {
      const values = f.picklistValues.filter((v) => v.active).slice(0, MAX_PICKLIST_VALUES)
      if (values.length) line += ` [${values.map((v) => v.value).join(', ')}]`
    }
    lines.push(line)
  }
  const children = d.childRelationships.filter((r) => r.relationshipName)
  if (detail.children && children.length) {
    lines.push('Child relationships:')
    for (const r of children) lines.push(`${name(r.relationshipName!)} -> ${name(r.childSObject)}`)
  }
  return lines.join('\n')
}

/** The fields of the objects, cut down until they fit the budget. */
export function objectInfo(describes: SObjectDescribe[], names: NameContext, budget = AI_BUDGET_BYTES): string {
  let text = ''
  for (const detail of DETAILS) {
    text = describes.map((d) => describeText(d, names, detail)).join('\n\n')
    if (bytes(text) <= budget) return text
  }
  return text
}

/** The org's objects for the AI to choose from: `ApiName (Label)` per line, without the noise. */
export function objectList(sobjects: SObjectSummary[], names: NameContext, budget = AI_BUDGET_BYTES): string {
  const kept = sobjects.filter((o) => o.queryable !== false && !NOISE.test(o.name))
  const name = (n: string) => soqlName(n, names.ns, names.omitNamespace)
  const withLabels = kept.map((o) => `${name(o.name)} (${o.label})`).join('\n')
  return bytes(withLabels) <= budget ? withLabels : kept.map((o) => name(o.name)).join('\n')
}
