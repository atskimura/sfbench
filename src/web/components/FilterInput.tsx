// The filter box above a list, with its own clear button: Firefox has none
// for type=search (docs/parity.md).
import { useRef } from 'react'
import { t } from '../i18n/i18n.ts'
import styles from './FilterInput.module.css'
import panel from './Panel.module.css'

export function FilterInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className={`${panel.search} ${styles.root}`}>
      <input
        ref={input}
        className={`${panel.input} ${styles.input}`}
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className={styles.clear}
          aria-label={t.clearFilter}
          title={t.clearFilter}
          onClick={() => {
            onChange('')
            input.current?.focus()
          }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      )}
    </div>
  )
}
