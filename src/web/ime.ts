// The Enter that commits IME conversion is not a command (docs/web.md "日本語入力").

/** Safari can deliver the Enter that commits IME conversion just after compositionend. */
const COMPOSITION_ENTER_MS = 100

/** Whether this Enter commits IME conversion. `compositionEndedAt` is Date.now() at the last compositionend. */
export function isImeEnter(e: { isComposing: boolean; keyCode: number }, compositionEndedAt: number): boolean {
  return e.isComposing || e.keyCode === 229 || Date.now() - compositionEndedAt < COMPOSITION_ENTER_MS
}
