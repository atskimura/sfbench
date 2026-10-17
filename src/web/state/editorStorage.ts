// The editor text survives a tab reload in the same org, and only that: the
// storage holds the text of the workspace shown and nothing else (docs/web.md
// "状態の持ち方", "非同期の流れ").
const EDITOR_KEY = 'sfbench.editor'

type Saved = { org: string; text: string }

/**
 * Makes the storage the editor's of `org`, which is being made, and returns
 * its first text: `initial` (the launch query) if given, else the text saved
 * for this org. The text of another org is removed, so that going back to it
 * later does not bring it back.
 */
export function claimEditorText(org: string, initial: string | undefined): string {
  if (initial !== undefined) {
    saveEditorText(org, initial)
    return initial
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(EDITOR_KEY) ?? 'null') as Saved | null
    if (saved && saved.org === org && typeof saved.text === 'string') return saved.text
    sessionStorage.removeItem(EDITOR_KEY)
  } catch {
    // Unreadable or unavailable: start empty.
  }
  return ''
}

export function saveEditorText(org: string, text: string): void {
  try {
    sessionStorage.setItem(EDITOR_KEY, JSON.stringify({ org, text } satisfies Saved))
  } catch {
    // Only the reload convenience is lost.
  }
}
