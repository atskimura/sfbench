// Columns and cell values of a query result (docs/web.md "結果の表").
// Columns come from the keys of the records, not from SELECT, as in
// lwc-soql-builder. The records stay as Salesforce returned them; a cell's
// value is read from its record when it is drawn.

export type SObjectRecord = Record<string, unknown>

/** One page of a query result holds up to 2000 records. */
export const PAGE_SIZE = 2000

/** A child relationship value: a subquery's records. */
export type ChildRecords = { totalSize: number; done?: boolean; records: SObjectRecord[] }

export type Column = {
  /** `Account.Name` style. */
  key: string
  path: string[]
  /** `child` for a subquery column (the cell shows the record count). */
  kind: 'value' | 'child'
}

export function isChildRecords(value: unknown): value is ChildRecords {
  return typeof value === 'object' && value !== null && Array.isArray((value as { records?: unknown }).records)
}

function isNested(value: unknown): value is SObjectRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !isChildRecords(value)
}

function keysOf(record: SObjectRecord, prefix: string[], out: Column[]): void {
  for (const [key, value] of Object.entries(record)) {
    if (key === 'attributes') continue
    const path = [...prefix, key]
    if (isNested(value)) keysOf(value, path, out)
    else out.push({ key: path.join('.'), path, kind: isChildRecords(value) ? 'child' : 'value' })
  }
}

/**
 * Adds the columns of `records` to `columns` (which is not changed). A new
 * column goes after the other columns of the same parent relationship. A
 * column that turns out to be a parent relationship (null on the earlier
 * pages, a record now) is replaced by the columns of that record.
 */
export function addColumns(columns: readonly Column[], records: readonly SObjectRecord[]): Column[] {
  const result = [...columns]
  const keys = new Set(result.map((c) => c.key))
  for (const record of records) {
    const found: Column[] = []
    keysOf(record, [], found)
    for (const column of found) {
      if (keys.has(column.key)) {
        if (column.kind === 'child') {
          const i = result.findIndex((c) => c.key === column.key)
          if (result[i].kind !== 'child') result[i] = column
        }
        continue
      }
      // A null parent relationship whose fields are already columns.
      if (result.some((c) => c.key.startsWith(`${column.key}.`))) continue
      keys.add(column.key)
      // A placeholder for this parent relationship (all null so far)?
      const parentIndex = column.path
        .slice(0, -1)
        .map((_, n) => column.path.slice(0, n + 1).join('.'))
        .map((parent) => result.findIndex((c) => c.key === parent))
        .find((i) => i !== -1)
      if (parentIndex !== undefined) {
        keys.delete(result[parentIndex].key)
        result.splice(parentIndex, 1, column)
        continue
      }
      result.splice(insertionIndex(result, column.path), 0, column)
    }
  }
  return result
}

/** After the last column sharing the longest parent path with `path`, or at the end. */
function insertionIndex(columns: readonly Column[], path: string[]): number {
  for (let depth = path.length - 1; depth > 0; depth--) {
    const prefix = path.slice(0, depth).join('.') + '.'
    let last = -1
    columns.forEach((c, i) => {
      if (c.key.startsWith(prefix)) last = i
    })
    if (last !== -1) return last + 1
  }
  return columns.length
}

export function cellValue(record: SObjectRecord, column: Column): unknown {
  let value: unknown = record
  for (const part of column.path) {
    if (!isNested(value)) return null
    value = value[part]
  }
  return value
}

/** The text of a cell, as shown in the table and written to CSV. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (isChildRecords(value)) return `${value.totalSize ?? value.records.length} rows`
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const SAMPLE_ROWS = 200
const MIN_WIDTH = 4
const MAX_WIDTH = 48

/** How wide text looks in `ch`: East Asian wide characters count as two. */
function textWidth(text: string): number {
  let width = 0
  for (const c of text) width += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u.test(c) ? 2 : 1
  return width
}

/**
 * Column widths in `ch`, from the header and the first 200 rows. They are
 * fixed once decided, so that they do not change as rows scroll in and out.
 */
export function columnWidth(column: Column, records: readonly SObjectRecord[]): number {
  let width = textWidth(column.key)
  for (const record of records.slice(0, SAMPLE_ROWS)) width = Math.max(width, textWidth(cellText(cellValue(record, column))))
  return Math.min(Math.max(width, MIN_WIDTH), MAX_WIDTH)
}

/** Numbers are right-aligned: true when the column's sampled values are all numbers. */
export function isNumberColumn(column: Column, records: readonly SObjectRecord[]): boolean {
  let seen = false
  for (const record of records.slice(0, SAMPLE_ROWS)) {
    const value = cellValue(record, column)
    if (value === null || value === undefined) continue
    if (typeof value !== 'number') return false
    seen = true
  }
  return seen
}
