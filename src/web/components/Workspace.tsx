// The SOQL workspace. PR 2b replaces this placeholder with the object list, editor and results.
import { t } from '../i18n/i18n.ts'
import { useOrgs } from '../state/OrgContext.tsx'
import styles from './Workspace.module.css'

export function Workspace() {
  const { selectedOrg, loading, orgs } = useOrgs()
  return (
    <section className={styles.placeholder} aria-busy={loading && !orgs}>
      {!orgs && loading ? t.loadingOrgs : selectedOrg ? `${selectedOrg.alias ?? selectedOrg.username}` : t.selectOrg}
    </section>
  )
}
