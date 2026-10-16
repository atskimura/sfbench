// CSV export (docs/web.md "CSV").
import { cellText, cellValue, type Column, type SObjectRecord } from './columns.ts'

/**
 * Spreadsheets run text that starts with these as a formula when they open
 * the CSV; a leading apostrophe keeps it text. Numbers are left alone.
 */
const FORMULA_START = /^[=+\-@\t\r]/

function field(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function valueField(value: unknown): string {
  const text = cellText(value)
  return field(typeof value === 'string' && FORMULA_START.test(text) ? `'${text}` : text)
}

/** CSV with a BOM, so that Excel reads it as UTF-8. Child relationship cells hold `N rows`. */
export function toCsv(columns: readonly Column[], records: readonly SObjectRecord[]): string {
  const lines = [columns.map((c) => field(c.key)).join(',')]
  for (const record of records) lines.push(columns.map((c) => valueField(cellValue(record, c))).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}

export function csvFileName(object: string | undefined): string {
  return `${object || 'query'}.csv`
}
