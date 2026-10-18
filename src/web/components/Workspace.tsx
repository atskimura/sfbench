// The SOQL workspace: objects and fields on the left, the editor and recent
// queries at the top right, results below (docs/screens.md "SOQL の画面").
// The object list, the editor area and the recent queries can be closed
// (docs/screens.md "パネルの開閉").
import { t } from '../i18n/i18n.ts'
import { AiProvider } from '../state/AiContext.tsx'
import { useOrgs, type Seed } from '../state/OrgContext.tsx'
import { PanelsProvider, usePanels } from '../state/PanelsContext.tsx'
import { SoqlProvider, useSoql } from '../state/SoqlContext.tsx'
import { EditorPanel, RunButton } from './EditorPanel.tsx'
import { ObjectPanel } from './ObjectPanel.tsx'
import panel from './Panel.module.css'
import { RecentPanel } from './RecentPanel.tsx'
import { ResultPanel } from './ResultPanel.tsx'
import styles from './Workspace.module.css'

export function Workspace() {
  const { selected, seed, loading, orgs } = useOrgs()
  // Nothing to work on before an org is chosen; typing then would be lost
  // on the first choice (docs/screens.md "既定の組織がないとき").
  if (!selected) {
    return (
      <section className={`${panel.panel} ${styles.noOrg}`} aria-busy={loading && !orgs}>
        <p className={panel.empty}>{!orgs && loading ? t.loadingOrgs : orgs?.length === 0 ? t.noOrgs : t.selectOrgFirst}</p>
      </section>
    )
  }
  // Remade for each org: switching orgs resets everything in it and stops
  // what it was running (docs/web.md "非同期の流れ").
  return <OrgWorkspace key={selected} username={selected} seed={seed} />
}

function OrgWorkspace({ username, seed }: { username: string; seed: Seed | undefined }) {
  return (
    <SoqlProvider username={username} seed={seed}>
      <PanelsProvider>
        {/* Inside both: Replace writes the editor, and Fix with AI opens the editor area. */}
        <AiProvider username={username}>
          <Layout username={username} initialText={seed?.query} />
        </AiProvider>
      </PanelsProvider>
    </SoqlProvider>
  )
}

// Layout does not read the SOQL state, so that typing (which changes it)
// does not draw the result table again; only the small parts below do.
function Layout({ username, initialText }: { username: string; initialText: string | undefined }) {
  const { open, setOpen } = usePanels()
  return (
    <div className={styles.workspace}>
      <div className={open.objects ? styles.left : styles.leftClosed}>
        {!open.objects && <ObjectsStrip onClick={() => setOpen('objects', true)} />}
        {/* Kept mounted while closed, so that the loaded lists stay. */}
        <div className={styles.fill} hidden={!open.objects}>
          <ObjectPanel username={username} />
        </div>
      </div>
      <div className={styles.right}>
        {/* The editor stays mounted while closed: CodeMirror keeps the text and its undo history. */}
        <div className={styles.top} hidden={!open.editor}>
          <EditorPanel username={username} initialText={initialText} />
          {open.recent ? (
            <RecentPanel />
          ) : (
            <Strip label={t.showRecent} text={t.recent} onClick={() => setOpen('recent', true)} />
          )}
        </div>
        {!open.editor && <ClosedEditor />}
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

function ObjectsStrip({ onClick }: { onClick: () => void }) {
  const soql = useSoql()
  return <Strip label={t.showObjects} text={soql.panelObject ?? t.sObjects} onClick={onClick} />
}

/** The closed editor area: the Run button and the first line of the query. */
function ClosedEditor() {
  const soql = useSoql()
  return (
    <div className={`${panel.panel} ${styles.closedEditor}`}>
      <RunButton />
      <code className={styles.firstLine}>{soql.firstLine}</code>
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
