// The SOQL workspace: objects and fields on the left, the editor and recent
// queries at the top right, results below (docs/screens.md "SOQL の画面").
// The object list, the editor area and the recent queries can be closed
// (docs/screens.md "パネルの開閉").
import { t } from '../i18n/i18n.ts'
import { useOrgs } from '../state/OrgContext.tsx'
import { PanelsProvider, usePanels } from '../state/PanelsContext.tsx'
import { SoqlProvider, useSoql } from '../state/SoqlContext.tsx'
import { EditorPanel, RunButton } from './EditorPanel.tsx'
import { ObjectPanel } from './ObjectPanel.tsx'
import panel from './Panel.module.css'
import { RecentPanel } from './RecentPanel.tsx'
import { ResultPanel } from './ResultPanel.tsx'
import styles from './Workspace.module.css'

export function Workspace() {
  return (
    <SoqlProvider>
      <PanelsProvider>
        <Layout />
      </PanelsProvider>
    </SoqlProvider>
  )
}

function Layout() {
  const { selectedOrg, loading, orgs } = useOrgs()
  const { open, setOpen } = usePanels()
  const soql = useSoql()
  return (
    <div className={styles.workspace}>
      <div className={open.objects ? styles.left : styles.leftClosed}>
        {!open.objects && (
          <Strip label={t.showObjects} text={soql.panelObject ?? t.sObjects} onClick={() => setOpen('objects', true)} />
        )}
        {/* Kept mounted while closed, so that the loaded lists stay. */}
        <div className={styles.fill} hidden={!open.objects}>
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
      </div>
      <div className={styles.right}>
        {/* The editor stays mounted while closed: CodeMirror keeps the text and its undo history. */}
        <div className={styles.top} hidden={!open.editor}>
          <EditorPanel />
          {open.recent ? (
            <RecentPanel />
          ) : (
            <Strip label={t.showRecent} text={t.recent} onClick={() => setOpen('recent', true)} />
          )}
        </div>
        {!open.editor && (
          <div className={`${panel.panel} ${styles.closedEditor}`}>
            <RunButton />
            <code className={styles.firstLine}>{soql.firstLine}</code>
          </div>
        )}
        <div className={styles.divider}>
          <button type="button" className={panel.button} onClick={() => setOpen('editor', !open.editor)} aria-expanded={open.editor}>
            {open.editor ? t.hideEditor : t.showEditor}
          </button>
        </div>
        <ResultPanel />
      </div>
    </div>
  )
}

/** A closed panel: a narrow vertical bar that opens it. */
function Strip({ label, text, onClick }: { label: string; text: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.strip} aria-label={label} title={label} onClick={onClick}>
      <span className={styles.stripText}>{text}</span>
    </button>
  )
}
