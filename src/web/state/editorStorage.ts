// The editor text survives a tab reload in the same org, and only that: the
// storage holds the text of the workspace shown and nothing else (docs/web.md
// "状態の持ち方", "非同期の流れ"). The SOQL and Apex editors each have their key.
const EDITOR_KEY = 'sfbench.editor'
export const APEX_DRAFT_KEY = 'sfbench.apexDraft'

type Saved = { org: string; text: string }

/**
 * Makes the storage the editor's of `org`, which is being made, and returns
 * its first text: `initial` (from the launch) if given, else the text saved
 * for this org. The text of another org is removed, so that going back to it
 * later does not bring it back.
 */
export function claimEditorText(org: string, initial: string | undefined, key = EDITOR_KEY): string {
  if (initial !== undefined) {
    saveEditorText(org, initial, key)
    return initial
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Saved | null
    if (saved && saved.org === org && typeof saved.text === 'string') return saved.text
    sessionStorage.removeItem(key)
  } catch {
    // Unreadable or unavailable: start empty.
  }
  return ''
}

export function saveEditorText(org: string, text: string, key = EDITOR_KEY): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ org, text } satisfies Saved))
  } catch {
    // Only the reload convenience is lost.
  }
}
