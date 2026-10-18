// The SOQL workspace: objects and fields on the left, the editor and recent
// queries at the top right, results below (docs/screens.md "SOQL の画面").
// The object list, the editor area and the recent queries can be closed
// (docs/screens.md "パネルの開閉").
import { useState } from 'react'
import { t } from '../i18n/i18n.ts'
import { AiProvider } from '../state/AiContext.tsx'
import { useApp } from '../state/AppContext.tsx'
import { RestProvider } from '../state/RestContext.tsx'
import { RestScreen } from './RestScreen.tsx'
import { Divider, Strip } from './Split.tsx'
import { useOrgs, type Seed } from '../state/OrgContext.tsx'
import { PanelsProvider, usePanels } from '../state/PanelsContext.tsx'
import { SoqlProvider, useSoql } from '../state/SoqlContext.tsx'
import { EditorPanel, RunButton } from './EditorPanel.tsx'
import { ObjectPanel } from './ObjectPanel.tsx'
import panel from './Panel.module.css'
import { RecentPanel } from './RecentPanel.tsx'
import { ResultPanel } from './ResultPanel.tsx'
import styles from './Workspace.module.css'

const SOQL_PANELS = ['objects', 'editor', 'recent'] as const

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

/**
 * Both screens stay drawn once opened, and the one not chosen is hidden, never
 * unmounted: a request running in it (a REST request that may change data, a
 * query) goes on, and its result shows when the screen is chosen again
 * (docs/rest.md "作業画面の作り"). Do not draw the screens conditionally.
 */
function OrgWorkspace({ username, seed }: { username: string; seed: Seed | undefined }) {
  const { mode } = useApp()
  // The REST API screen is made when it is first chosen, then kept.
  const [restOpened, setRestOpened] = useState(mode === 'rest')
  if (mode === 'rest' && !restOpened) setRestOpened(true)
  return (
    <>
      <div className={styles.screen} hidden={mode !== 'soql'}>
        <SoqlProvider username={username} seed={seed}>
          <PanelsProvider storageKey="sfbench.panels" names={SOQL_PANELS}>
            {/* Inside both: Replace writes the editor, and Fix with AI opens the editor area. */}
            <AiProvider username={username}>
              <Layout username={username} initialText={seed?.query} />
            </AiProvider>
          </PanelsProvider>
        </SoqlProvider>
      </div>
      {restOpened && (
        <div className={styles.screen} hidden={mode !== 'rest'}>
          <RestProvider username={username} seed={seed}>
            <RestScreen />
          </RestProvider>
        </div>
      )}
    </>
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
        <Divider open={open.editor} showLabel={t.showEditor} hideLabel={t.hideEditor} onToggle={() => setOpen('editor', !open.editor)} />
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
