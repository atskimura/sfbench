// The editor text survives a tab reload in the same org, and only that:
// switching orgs clears it (docs/web.md "状態の持ち方", "非同期の流れ").
const EDITOR_KEY = 'sfbench.editor'

type Saved = { org: string; text: string }

export function savedEditorText(org: string): string {
  try {
    const saved = JSON.parse(sessionStorage.getItem(EDITOR_KEY) ?? 'null') as Saved | null
    return saved && saved.org === org && typeof saved.text === 'string' ? saved.text : ''
  } catch {
    return ''
  }
}

export function saveEditorText(org: string, text: string): void {
  try {
    sessionStorage.setItem(EDITOR_KEY, JSON.stringify({ org, text } satisfies Saved))
  } catch {
    // Only the reload convenience is lost.
  }
}

export function clearEditorText(): void {
  try {
    sessionStorage.removeItem(EDITOR_KEY)
  } catch {
    // Nothing was kept.
  }
}
