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

/** Where `query` is in `text`, ignoring case where it can. An empty query finds nothing. */
export function findMatches(text: string, query: string): Match[] {
  if (!query) return []
  // Lower case can change a text's length ('İ' becomes two characters): then
  // the positions would not be the text's, so case counts.
  const lower = text.toLowerCase()
  const folded = lower.length === text.length
  const haystack = folded ? lower : text
  const needle = folded ? query.toLowerCase() : query
  const matches: Match[] = []
  for (let at = haystack.indexOf(needle); at !== -1 && matches.length < MAX_MATCHES; at = haystack.indexOf(needle, at + needle.length)) {
    matches.push({ from: at, to: at + needle.length })
  }
  return matches
}
