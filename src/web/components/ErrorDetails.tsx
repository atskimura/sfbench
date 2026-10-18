// The raw details of an error (such as Salesforce's error JSON), shown on demand.
import { t } from '../i18n/i18n.ts'
import styles from './ErrorDetails.module.css'

export function ErrorDetails({ details }: { details: unknown }) {
  if (details === undefined) return null
  return (
    <details>
      <summary>{t.errorDetails}</summary>
      <pre className={styles.details}>{typeof details === 'string' ? details : JSON.stringify(details, null, 2)}</pre>
    </details>
  )
}
