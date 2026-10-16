// Where the cursor is in SOQL that is still being typed, for completion
// (docs/web.md "文脈の判定"). soql-parser-js cannot parse most half-written
// SOQL, so this splits the text into tokens and follows clauses and subqueries.

/** A query or subquery and the object it reads. */
export type Scope = {
  /** The name after FROM: an object, or a child relationship in a SELECT subquery. */
  from: string | undefined
  alias: string | undefined
  /** A subquery in SELECT, whose FROM is a child relationship of `parent`. */
  child: boolean
  parent: Scope | undefined
}

export type CursorContext =
  /** Right after FROM: object names, or child relationship names in a SELECT subquery. */
  | { kind: 'from'; scope: Scope }
  /** Fields of the scope's object, following `path` (parent relationships typed before the word). */
  | { kind: 'field'; scope: Scope; path: string[] }
  | { kind: 'keyword' }
  /** Inside a string literal: no completion. */
  | { kind: 'none' }

export type CursorInfo = {
  context: CursorContext
  /** The word being typed (after the last dot). */
  word: string
  /** Where the word starts; the completion replaces from here. */
  from: number
  /** The cursor is right after a dot (`Account.`). */
  afterDot: boolean
}

type Token = { type: 'word' | 'string' | 'punct'; text: string; start: number; end: number }

const WORD = /[\p{L}\p{N}_]/u
const CLAUSES = new Set(['select', 'from', 'where', 'group', 'having', 'order', 'limit', 'offset', 'with', 'for', 'using'])
const FIELD_CLAUSES = new Set(['select', 'where', 'group', 'having', 'order'])

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (/\s/.test(c)) {
      i++
    } else if (c === "'") {
      const start = i++
      while (i < text.length && text[i] !== "'") i += text[i] === '\\' ? 2 : 1
      i = Math.min(i + 1, text.length + 1)
      tokens.push({ type: 'string', text: text.slice(start, i), start, end: i })
    } else if (WORD.test(c)) {
      const start = i
      while (i < text.length && WORD.test(text[i])) i++
      tokens.push({ type: 'word', text: text.slice(start, i), start, end: i })
    } else {
      tokens.push({ type: 'punct', text: c, start: i, end: ++i })
    }
  }
  return tokens
}

type Frame = {
  /** Set for a query or subquery; undefined for other parentheses (functions, IN lists, grouping). */
  scope: Scope | undefined
  clause: string | undefined
  /** Words seen in the current clause (to find the name right after FROM, and the alias). */
  clauseWords: number
  /** The query frame this frame is in. */
  query: Frame | undefined
}

export function cursorInfo(text: string, pos: number): CursorInfo {
  // The word and the dotted path before the cursor, such as `Account.Owner.Na`.
  let pathStart = pos
  while (pathStart > 0 && (WORD.test(text[pathStart - 1]) || text[pathStart - 1] === '.')) pathStart--
  const parts = text.slice(pathStart, pos).split('.')
  const word = parts[parts.length - 1]
  const path = parts.slice(0, -1)
  const info = { word, from: pos - word.length, afterDot: path.length > 0 && word === '' }

  const tokens = tokenize(text)
  const root: Frame = { scope: { from: undefined, alias: undefined, child: false, parent: undefined }, clause: undefined, clauseWords: 0, query: undefined }
  root.query = root
  const stack: Frame[] = [root]
  let atCursor: { frame: Frame; clause: string | undefined; clauseWords: number } | undefined

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!atCursor && token.end > pathStart) {
      if (token.type === 'string' && token.start < pos) return { ...info, context: { kind: 'none' } }
      const frame = stack[stack.length - 1]
      atCursor = { frame, clause: frame.query?.clause, clauseWords: frame.query?.clauseWords ?? 0 }
    }
    const frame = stack[stack.length - 1]
    if (token.type === 'punct') {
      if (token.text === '(') {
        const isSubquery = tokens[i + 1]?.type === 'word' && tokens[i + 1].text.toLowerCase() === 'select'
        const parentQuery = frame.query
        const scope: Scope | undefined = isSubquery
          ? { from: undefined, alias: undefined, child: parentQuery?.clause === 'select', parent: parentQuery?.scope }
          : undefined
        const next: Frame = { scope, clause: undefined, clauseWords: 0, query: undefined }
        next.query = scope ? next : frame.query
        stack.push(next)
      } else if (token.text === ')' && stack.length > 1) {
        stack.pop()
      }
      continue
    }
    if (token.type !== 'word') continue
    const query = frame.query
    if (!query) continue
    const lower = token.text.toLowerCase()
    // Only words directly in the query (not inside a function's parentheses) change clauses.
    if (frame === query && CLAUSES.has(lower) && !(query.clause === 'from' && query.clauseWords === 0)) {
      query.clause = lower
      query.clauseWords = 0
      continue
    }
    if (frame === query && query.clause === 'from' && query.scope) {
      // FROM Account, FROM Account a, FROM a.Contacts c (the last part is the name).
      const dotted = tokens[i - 1]?.text === '.' && query.clauseWords > 0
      if (query.clauseWords === 0 || dotted) query.scope.from = token.text
      else if (!query.scope.alias && lower !== 'as') query.scope.alias = token.text
    }
    if (frame === query) query.clauseWords++
  }
  if (!atCursor) {
    const frame = stack[stack.length - 1]
    atCursor = { frame, clause: frame.query?.clause, clauseWords: frame.query?.clauseWords ?? 0 }
  }

  const scope = atCursor.frame.query?.scope
  if (!scope) return { ...info, context: { kind: 'keyword' } }
  if (atCursor.clause === 'from') {
    return { ...info, context: atCursor.clauseWords === 0 && path.length === 0 ? { kind: 'from', scope } : { kind: 'keyword' } }
  }
  if (atCursor.clause && FIELD_CLAUSES.has(atCursor.clause)) {
    // A leading alias (`a.Name` with `FROM Account a`) is the object itself.
    const withoutAlias = scope.alias && path[0]?.toLowerCase() === scope.alias.toLowerCase() ? path.slice(1) : path
    return { ...info, context: { kind: 'field', scope, path: withoutAlias } }
  }
  return { ...info, context: { kind: 'keyword' } }
}
