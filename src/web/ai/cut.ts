// Text from a run sent to the AI (docs/ai-agent.md): a response body, an error,
// debug output. Its start is what tells most; a whole HTML error page or a long
// log would not fit what the server takes.

/** The most of such a text sent. */
export const MAX_RUN_TEXT = 16_000

export function cutRunText(text: string): string {
  return text.length > MAX_RUN_TEXT ? `${text.slice(0, MAX_RUN_TEXT)}\n(cut)` : text
}
