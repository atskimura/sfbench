// Apex for CodeMirror, as a stream of tokens (docs/apex.md "Apex の色分け"):
// keywords in any case, '...' strings, [SELECT ...] SOQL, @annotations and
// comments. Not a parser: it only colors.
import { StreamLanguage, type StreamParser } from '@codemirror/language'

const words = (list: string) => new Set(list.split(' '))

const KEYWORDS = words(
  'abstract break catch class continue do else enum extends final finally for global if implements inherited interface instanceof new override private protected public return sharing static super switch on this throw transient try virtual webservice when while with without testmethod get set insert update upsert delete undelete merge',
)
const TYPES = words('void string integer long double decimal boolean id date datetime time blob object list map sobject')
const ATOMS = words('null true false')
const SOQL_KEYWORDS = words(
  'select from where and or not in like limit offset order by asc desc nulls first last group having with security_enforced user_mode system_mode for update view reference includes excludes find returning all rows typeof when then else end using scope tracking viewstat',
)

/** `bracketOpen`: a `[` ended its line, so SOQL may start on the next one. */
type State = { inComment: boolean; inSoql: boolean; bracketOpen: boolean }

export const apexParser: StreamParser<State> = {
  name: 'apex',
  startState: () => ({ inComment: false, inSoql: false, bracketOpen: false }),
  token(stream, state) {
    if (state.inComment) {
      if (stream.skipTo('*/')) {
        stream.next()
        stream.next()
        state.inComment = false
      } else {
        stream.skipToEnd()
      }
      return 'comment'
    }
    if (stream.eatSpace()) return null
    // A `[` at the end of the line before: SOQL if the first word here is SELECT or FIND.
    if (state.bracketOpen) {
      state.bracketOpen = false
      if (stream.match(/^(select|find)\b/i, false)) state.inSoql = true
    }
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match('/*')) {
      state.inComment = true
      return 'comment'
    }
    if (stream.peek() === "'") {
      stream.next()
      let escaped = false
      for (let ch = stream.next(); ch !== undefined; ch = stream.next()) {
        if (ch === "'" && !escaped) break
        escaped = !escaped && ch === '\\'
      }
      return 'string'
    }
    if (state.inSoql) {
      if (stream.eat(']')) {
        state.inSoql = false
        return 'bracket'
      }
      // A bound Apex variable, `:name`.
      if (stream.match(/^:\s*[A-Za-z_]\w*/)) return 'variableName'
    } else if (stream.match(/^\[(?=\s*(select|find)\b)/i)) {
      state.inSoql = true
      return 'bracket'
    } else if (stream.match(/^\[\s*$/)) {
      state.bracketOpen = true
      return 'bracket'
    }
    if (stream.match(/^@[A-Za-z_]\w*/)) return 'meta'
    if (stream.match(/^\d+(\.\d+)?[lLdD]?/)) return 'number'
    if (stream.match(/^[A-Za-z_]\w*/)) {
      const word = stream.current().toLowerCase()
      if (ATOMS.has(word)) return 'atom'
      if (state.inSoql) return SOQL_KEYWORDS.has(word) ? 'keyword' : null
      if (KEYWORDS.has(word)) return 'keyword'
      if (TYPES.has(word)) return 'typeName'
      return null
    }
    stream.next()
    return null
  },
  languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } } },
}

export const apex = StreamLanguage.define(apexParser)
