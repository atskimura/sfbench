// A modal question with Cancel and a confirm button (such as before a CSV
// export that loads many pages). Shares the look of the settings dialog.
import { useEffect, useId, useRef } from 'react'
import { t } from '../i18n/i18n.ts'
import styles from './SettingsDialog.module.css'

type Props = {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const messageId = useId()
  useEffect(() => {
    dialog.current?.showModal?.()
  }, [])
  return (
    <dialog
      ref={dialog}
      className={`${styles.dialog} ${styles.small}`}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      // Escape closes the dialog: the same as Cancel.
      onCancel={onCancel}
    >
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
      </div>
      <p id={messageId} className={styles.section}>
        {message}
      </p>
      <div className={styles.actions}>
        {/* Cancel comes first and takes the focus: the confirm button spends API calls. */}
        <button type="button" className={styles.button} onClick={onCancel}>
          {t.cancel}
        </button>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
