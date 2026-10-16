// Bands under the header: the server is unreachable, and the production org warning.
import { t } from '../i18n/i18n.ts'
import { useApp } from '../state/AppContext.tsx'
import { useOrgs } from '../state/OrgContext.tsx'
import styles from './Banners.module.css'
import { CommandText } from './CommandText.tsx'

export function Banners() {
  const { sessionLost } = useApp()
  const { isProduction, selectedOrg } = useOrgs()
  return (
    <>
      {sessionLost && (
        <div className={`${styles.band} ${styles.lost}`} role="alert">
          <CommandText text={t.sessionLost} />
        </div>
      )}
      {isProduction && selectedOrg && (
        <div className={`${styles.band} ${styles.production}`} role="status">
          <strong>{t.production}</strong>
          <span>{selectedOrg.alias ?? selectedOrg.username}</span>
        </div>
      )}
    </>
  )
}
