// The difference between the editor text and the AI's proposal, word by word
// (docs/ai.md "提案カード"). A longest common subsequence, written here
// rather than adding a library.

export type DiffPart = { text: string; kind: 'same' | 'added' | 'removed' }

/** Words, numbers and names (with dots), quoted strings, and single symbols, each with the spaces before it. */
const TOKEN = /\s*('(?:\\.|[^'\\])*'?|[\p{L}\p{N}_.]+|[^\s\p{L}\p{N}_.])/gu
/** Above this many cell comparisons the diff is skipped (the proposal is shown alone). */
const MAX_CELLS = 1_000_000
/** Below this share of words in common, a word diff is harder to read than the proposal alone. */
const MIN_COMMON = 0.5

type Token = { text: string; key: string }

const tokens = (text: string): Token[] => [...text.matchAll(TOKEN)].map((m) => ({ text: m[0], key: m[1].toLowerCase() }))

/**
 * The proposal word by word, with the words only in `before` as removed and
 * the words only in `after` as added, keeping the spacing of each text. Case
 * differences (select, SELECT) are not differences. Undefined when the texts
 * are too long to compare or have too little in common to read as a diff.
 */
export function diffWords(before: string, after: string): DiffPart[] | undefined {
  const a = tokens(before)
  const b = tokens(after)
  if (a.length * b.length > MAX_CELLS) return undefined
  const same = (i: number, j: number) => a[i].key === b[j].key
  // lcs[i][j]: length of the common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = same(i, j) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  if (b.length > 0 && lcs[0][0] < b.length * MIN_COMMON) return undefined
  const parts: DiffPart[] = []
  const push = (text: string, kind: DiffPart['kind']) => {
    const last = parts[parts.length - 1]
    if (last?.kind === kind) last.text += text
    else parts.push({ text, kind })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (same(i, j)) {
      push(b[j].text, 'same')
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push(a[i++].text, 'removed')
    } else {
      push(b[j++].text, 'added')
    }
  }
  while (i < a.length) push(a[i++].text, 'removed')
  while (j < b.length) push(b[j++].text, 'added')
  return parts
}
