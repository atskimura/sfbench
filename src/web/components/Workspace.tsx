// The SOQL workspace: objects and fields on the left, the editor and recent
// queries at the top right, results below (docs/screens.md "SOQL の画面").
import { t } from '../i18n/i18n.ts'
import { useOrgs } from '../state/OrgContext.tsx'
import { SoqlProvider } from '../state/SoqlContext.tsx'
import { EditorPanel } from './EditorPanel.tsx'
import { ObjectPanel } from './ObjectPanel.tsx'
import panel from './Panel.module.css'
import { RecentPanel } from './RecentPanel.tsx'
import { ResultPanel } from './ResultPanel.tsx'
import styles from './Workspace.module.css'

export function Workspace() {
  const { selectedOrg, loading, orgs } = useOrgs()
  return (
    <SoqlProvider>
      <div className={styles.workspace}>
        <div className={styles.left}>
          {selectedOrg ? (
            <ObjectPanel key={selectedOrg.username} username={selectedOrg.username} />
          ) : (
            <section className={panel.panel} aria-busy={loading && !orgs}>
              <div className={panel.header}>
                <span className={panel.title}>{t.sObjects}</span>
              </div>
              <p className={panel.empty}>{!orgs && loading ? t.loadingOrgs : t.selectOrg}</p>
            </section>
          )}
        </div>
        <div className={styles.right}>
          <div className={styles.top}>
            <EditorPanel />
            <RecentPanel />
          </div>
          <ResultPanel />
        </div>
      </div>
    </SoqlProvider>
  )
}
