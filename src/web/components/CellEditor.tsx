// The input that replaces a cell being edited (docs/edit.md "セルを書き換える"):
// chosen by the field's type. Enter (Cmd+Enter in a text area) or leaving the
// input keeps the value; Esc puts it back. Only what the user changed is kept:
// opening and leaving a cell never changes it (a browser input rewrites line
// breaks, and a select would take the first value moved to).
import { useEffect, useRef, type KeyboardEvent } from 'react'
import type { FieldValue } from '../../shared/api.ts'
import type { FieldDescribe } from '../apiClient.ts'
import { t } from '../i18n/i18n.ts'
import { fieldValue, inputKind, inputText } from '../results/editable.ts'
import { isImeEnter } from '../ime.ts'
import styles from './ResultTable.module.css'

type Props = {
  field: FieldDescribe
  /** The value shown in the cell now: changed, or as Salesforce returned it. */
  value: unknown
  label: string
  onCommit: (value: FieldValue) => void
  onCancel: () => void
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

export function CellEditor({ field, value, label, onCommit, onCancel }: Props) {
  const control = useRef<Control>(null)
  // Once kept or put back, a later blur (the input going away) does nothing.
  const ended = useRef(false)
  // Whether the user changed the text; untouched, leaving keeps the value as it was.
  const touched = useRef(false)
  // Safari can send the Enter that commits IME conversion just after it ends.
  const composedAt = useRef(0)
  const initial = inputText(value)
  // A value with a line break opens in a text area, which keeps it.
  const kind = inputKind(field) === 'text' && /[\r\n]/.test(initial) ? 'textarea' : inputKind(field)

  const end = (keep: boolean) => {
    if (ended.current) return
    ended.current = true
    const input = control.current
    if (keep && touched.current && input) onCommit(kind === 'checkbox' && input instanceof HTMLInputElement ? input.checked : fieldValue(input.value))
    else onCancel()
  }
  const latest = useRef(end)
  useEffect(() => {
    latest.current = end
  })
  // A row scrolled out of the drawn rows takes its input away without a blur:
  // keep what was typed. Checked a moment later, as StrictMode takes effects
  // down and up again at once without the input going away.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      setTimeout(() => {
        if (!mounted.current) latest.current(true)
      }, 0)
    }
  }, [])

  const onKeyDown = (e: KeyboardEvent<Control>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      end(false)
      return
    }
    if (e.key !== 'Enter' || isImeEnter(e.nativeEvent, composedAt.current)) return
    // A text area takes Enter for a new line; Cmd+Enter keeps the value.
    if (kind === 'textarea' && !(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    end(true)
  }
  const common = {
    'aria-label': label,
    autoFocus: true,
    defaultValue: initial,
    onKeyDown,
    onChange: () => (touched.current = true),
    onBlur: () => end(true),
  }

  if (kind === 'checkbox') {
    // Space or a click flips it; Enter or leaving keeps it, as for the other types.
    const { defaultValue: _, ...rest } = common
    return (
      <span className={styles.checkboxEditor}>
        <input ref={(el) => void (control.current = el)} type="checkbox" defaultChecked={value === true} {...rest} />
      </span>
    )
  }
  if (kind === 'picklist') {
    const values = (field.picklistValues ?? []).filter((v) => v.active).map((v) => v.value)
    // A value no longer active stays choosable, so that opening the list changes nothing.
    if (initial && !values.includes(initial)) values.unshift(initial)
    return (
      <select ref={(el) => void (control.current = el)} className={styles.editor} {...common}>
        <option value="">{t.picklistNone}</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    )
  }
  if (kind === 'textarea') {
    return (
      <textarea
        ref={(el) => void (control.current = el)}
        className={`${styles.editor} ${styles.textareaEditor}`}
        {...common}
        onCompositionEnd={() => (composedAt.current = Date.now())}
      />
    )
  }
  return (
    <input
      ref={(el) => void (control.current = el)}
      className={styles.editor}
      spellCheck={false}
      {...common}
      onCompositionEnd={() => (composedAt.current = Date.now())}
    />
  )
}
