// A notice at the top of the REST API and Apex screens, closed by the user.
import { t } from '../i18n/i18n.ts'
import styles from './Notice.module.css'

export function Notice({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className={styles.notice} role="status">
      <span>{text}</span>
      <button type="button" className={styles.close} aria-label={t.dismiss} onClick={onClose}>
        ×
      </button>
    </div>
  )
}
