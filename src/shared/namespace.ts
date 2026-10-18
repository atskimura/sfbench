// The org's namespace prefix: omitted when composing SOQL, ignored when matching
// names (docs/web.md "SOQL と項目の選択の同期").

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

/** A key for comparing names: namespace removed, case ignored. */
export function nameKey(name: string, ns: string | null | undefined): string {
  return stripNamespace(name, ns).toLowerCase()
}

/** The name to write into SOQL, following the "omit the namespace" setting. */
export function soqlName(name: string, ns: string | null | undefined, omitNamespace: boolean): string {
  return omitNamespace ? stripNamespace(name, ns) : name
}

/** The item named in SOQL (matching case and namespace loosely), such as an object in the describeGlobal list. */
export function findByName<T extends { name: string }>(items: T[], name: string, ns: string | null | undefined): T | undefined {
  const key = nameKey(name, ns)
  return items.find((item) => nameKey(item.name, ns) === key)
}
