// The org's namespace prefix: omitted when composing SOQL, ignored when matching
// names (docs/web.md "SOQL と項目の選択の同期").

// Names that a managed package prefixes: custom objects and fields
// (`__c`, `__r`, ...). The same pattern as lwc-soql-builder's fullApiName.
const MANAGED_NAME = /^([a-z]|_(?!_))*[a-z]__(?:[cr]|Share|latitude__s|longitude__s)$/i

function stripOne(name: string, ns: string): string {
  const prefix = `${ns}__`
  return name.toLowerCase().startsWith(prefix.toLowerCase()) ? name.slice(prefix.length) : name
}

/** Removes the namespace from each dot-separated part. */
export function stripNamespace(name: string, ns: string | null | undefined): string {
  if (!ns) return name
  return name
    .split('.')
    .map((part) => stripOne(part, ns))
    .join('.')
}

/** Adds the namespace to each dot-separated part that is a custom name without one. */
export function addNamespace(name: string, ns: string | null | undefined): string {
  if (!ns) return name
  return name
    .split('.')
    .map((part) => (MANAGED_NAME.test(part) ? `${ns}__${part}` : part))
    .join('.')
}

/** A key for comparing names: namespace removed, case ignored. */
export function nameKey(name: string, ns: string | null | undefined): string {
  return stripNamespace(name, ns).toLowerCase()
}

/** The name to write into SOQL, following the "omit the namespace" setting. */
export function soqlName(name: string, ns: string | null | undefined, omitNamespace: boolean): string {
  return omitNamespace ? stripNamespace(name, ns) : name
}
