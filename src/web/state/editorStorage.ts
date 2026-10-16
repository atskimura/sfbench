// The editor text survives a tab reload (docs/web.md "状態の持ち方").
const EDITOR_KEY = 'sfbench.editor'

export function savedEditorText(): string {
  try {
    return sessionStorage.getItem(EDITOR_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveEditorText(text: string): void {
  try {
    sessionStorage.setItem(EDITOR_KEY, text)
  } catch {
    // Only the reload convenience is lost.
  }
}
