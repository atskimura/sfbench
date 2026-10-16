import { t } from '../i18n/i18n.ts'
import { useApp } from '../state/AppContext.tsx'
import { CopyCommand } from './CopyCommand.tsx'
import styles from './Notifications.module.css'

/** Error notifications in the corner, with an optional command and JSON details. */
export function Notifications() {
  const { notifications, dismiss } = useApp()
  if (notifications.length === 0) return null
  return (
    <div className={styles.stack} role="status" aria-live="polite">
      {notifications.map((n) => (
        <div key={n.id} className={styles.item}>
          <div className={styles.row}>
            <span className={styles.message}>{n.message}</span>
            <button type="button" className={styles.dismiss} aria-label={t.dismiss} onClick={() => dismiss(n.id)}>
              ×
            </button>
          </div>
          {n.command && <CopyCommand command={n.command} />}
          {n.details !== undefined && (
            <details>
              <summary>{t.errorDetails}</summary>
              <pre className={styles.details}>{JSON.stringify(n.details, null, 2)}</pre>
            </details>
          )}
        </div>
      ))}
    </div>
  )
}
