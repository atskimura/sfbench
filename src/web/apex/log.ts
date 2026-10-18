// The debug log: its entries, "USER_DEBUG only" and the search
// (docs/apex.md "画面の構成"). Pure, so that it is tested with a recorded log.

/** A line that starts an entry: `12:34:56.7 (1234567)|`. */
const ENTRY_START = /^\d{2}:\d{2}:\d{2}\.\d+ \(\d+\)\|/

/**
 * The entries of a log, each with the lines that follow it until the next
 * one: a multi-line System.debug value stays whole. The lines before the first
 * entry (the settings and "Execute Anonymous:") are one entry of their own.
 */
export function logEntries(log: string): string[] {
  const entries: string[] = []
  let current: string[] = []
  for (const line of log.split('\n')) {
    if (ENTRY_START.test(line) && current.length > 0) {
      entries.push(current.join('\n'))
      current = []
    }
    current.push(line)
  }
  if (current.length > 0 && !(current.length === 1 && current[0] === '')) entries.push(current.join('\n'))
  return entries
}

/** The USER_DEBUG entries only, whole. */
export function userDebugOnly(log: string): string {
  return logEntries(log)
    .filter((entry) => ENTRY_START.test(entry) && entry.split('\n', 1)[0].split('|')[1] === 'USER_DEBUG')
    .join('\n')
}

/** Matches above this many are not all marked: the count shows it as "N+". */
export const MAX_MATCHES = 10_000

export type Match = { from: number; to: number }

/** Where `query` is in `text`, ignoring case. An empty query finds nothing. */
export function findMatches(text: string, query: string): Match[] {
  if (!query) return []
  // On the text itself, not a lower-cased copy, whose length can differ ('İ' becomes two characters).
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  const matches: Match[] = []
  for (let m = pattern.exec(text); m && matches.length < MAX_MATCHES; m = pattern.exec(text)) {
    matches.push({ from: m.index, to: m.index + m[0].length })
  }
  return matches
}
