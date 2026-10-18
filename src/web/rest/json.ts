// JSON for the REST API screen, kept as written: formatting works on the text,
// so that a number with more digits than a double holds (a Number(18,0) value)
// is shown and sent as it is, never rounded by JSON.parse and stringify.

/** The JSON text with two-space indents, or undefined if it is not JSON. */
export function formatJson(text: string): string | undefined {
  try {
    JSON.parse(text)
  } catch {
    return undefined
  }
  let out = ''
  let depth = 0
  let inString = false
  const newline = () => '\n' + '  '.repeat(depth)
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      out += c
      if (c === '\\') out += text[++i]
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') {
      inString = true
      out += c
    } else if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']'
      const rest = text.slice(i + 1).trimStart()
      if (rest.startsWith(close)) {
        // An empty object or array stays on one line.
        out += c + close
        i = text.indexOf(close, i + 1)
      } else {
        depth++
        out += c + newline()
      }
    } else if (c === '}' || c === ']') {
      depth--
      out += newline() + c
    } else if (c === ',') {
      out += ',' + newline()
    } else if (c === ':') {
      out += ': '
    } else if (!/\s/.test(c)) {
      out += c
    }
  }
  return out
}

/** Above this, a response body is shown as it came, cut (docs/rest.md "ボディの欄とレスポンスの表示"). */
const FORMAT_LIMIT = 2 * 1024 * 1024
const SHOWN_WHEN_CUT = 200 * 1024

/** What the response panel shows for a body: formatted JSON, the text as it came, or its start. */
export function responseText(body: string): { text: string; json: boolean; cut: boolean } {
  if (body.length > FORMAT_LIMIT) return { text: body.slice(0, SHOWN_WHEN_CUT), json: false, cut: true }
  const formatted = formatJson(body)
  return formatted === undefined ? { text: body, json: false, cut: false } : { text: formatted, json: true, cut: false }
}

/** A size for people: 512 B, 3.4 KB, 1.2 MB. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
