// The input that replaces a cell being edited (docs/edit.md "セルを書き換える"):
// chosen by the field's type. Enter (Cmd+Enter in a text area) or leaving the
// input keeps the value; Esc puts it back.
import { useRef, type KeyboardEvent } from 'react'
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

export function CellEditor({ field, value, label, onCommit, onCancel }: Props) {
  // Once kept or put back, a later blur (the input going away) does nothing.
  const ended = useRef(false)
  // Safari can send the Enter that commits IME conversion just after it ends.
  const composedAt = useRef(0)
  const end = (action: () => void) => {
    if (ended.current) return
    ended.current = true
    action()
  }
  const commit = (text: string) => end(() => onCommit(fieldValue(text)))
  const cancel = () => end(onCancel)
  const kind = inputKind(field)
  const initial = inputText(value)

  if (kind === 'picklist') {
    const values = (field.picklistValues ?? []).filter((v) => v.active).map((v) => v.value)
    // A value no longer active stays choosable, so that opening the list changes nothing.
    if (initial && !values.includes(initial)) values.unshift(initial)
    return (
      <select
        className={styles.editor}
        aria-label={label}
        autoFocus
        defaultValue={initial}
        onChange={(e) => commit(e.target.value)}
        onBlur={cancel}
        onKeyDown={(e) => e.key === 'Escape' && cancel()}
      >
        <option value="">{t.picklistNone}</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    )
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
      return
    }
    if (e.key !== 'Enter' || isImeEnter(e.nativeEvent, composedAt.current)) return
    // A text area takes Enter for a new line; Cmd+Enter keeps the value.
    if (kind === 'textarea' && !(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    commit(e.currentTarget.value)
  }

  if (kind === 'textarea') {
    return (
      <textarea
        className={`${styles.editor} ${styles.textareaEditor}`}
        aria-label={label}
        autoFocus
        defaultValue={initial}
        onKeyDown={onKeyDown}
        onCompositionEnd={() => (composedAt.current = Date.now())}
        onBlur={(e) => commit(e.currentTarget.value)}
      />
    )
  }
  return (
    <input
      className={styles.editor}
      aria-label={label}
      autoFocus
      defaultValue={initial}
      spellCheck={false}
      onKeyDown={onKeyDown}
      onCompositionEnd={() => (composedAt.current = Date.now())}
      onBlur={(e) => commit(e.currentTarget.value)}
    />
  )
}
