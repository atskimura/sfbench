// The API version for the SOQL and Apex screens (docs/web.md "API バージョン"):
// the latest by default, or one the org supports.
import { useId } from 'react'
import { t } from '../i18n/i18n.ts'
import { apiVersions, useLoadable } from '../state/describeCache.ts'
import styles from './ApiVersionSelect.module.css'

export function ApiVersionSelect({ username, value, onChange }: { username: string; value: string | undefined; onChange: (version: string | undefined) => void }) {
  const id = useId()
  const versions = useLoadable(username, () => apiVersions(username))
  const list = versions.data ?? []
  const latest = list[list.length - 1]
  return (
    <span className={styles.version}>
      <label htmlFor={id}>{t.apiVersion}</label>
      <select id={id} aria-label={t.apiVersionLabel} className={styles.select} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{latest ? t.apiVersionLatest(latest) : t.apiVersionLatestUnknown}</option>
        {/* Newest first. The chosen one stays listed even when the list lacks it (while it
            loads, or a recent query's version since retired): the select shows what is sent. */}
        {[...(value && !list.slice(0, -1).includes(value) && value !== latest ? [value] : []), ...list.slice(0, -1).reverse()].map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </span>
  )
}
