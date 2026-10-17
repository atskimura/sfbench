// The editor with its toolbar (docs/screens.md "AI の入力欄、エディタ、最近のクエリ").
import { useId } from 'react'
import { t } from '../i18n/i18n.ts'
import { useOrgs } from '../state/OrgContext.tsx'
import { useResult, useSoql } from '../state/SoqlContext.tsx'
import styles from './EditorPanel.module.css'
import panel from './Panel.module.css'
import { SoqlEditor } from './SoqlEditor.tsx'

export function RunButton() {
  const soql = useSoql()
  const { result } = useResult()
  const { selected } = useOrgs()
  return (
    <button
      type="button"
      className={`${panel.button} ${panel.primary}`}
      disabled={!selected || result.state === 'running'}
      onClick={soql.run}
      aria-keyshortcuts="Meta+Enter Control+Enter"
    >
      {result.state === 'running' ? t.running : t.run}
      <span className={styles.shortcut}>⌘↵</span>
    </button>
  )
}

export function EditorPanel() {
  const soql = useSoql()
  const { selected } = useOrgs()
  const queryAllId = useId()
  const toolingId = useId()
  const noOrg = !selected

  return (
    <section className={panel.panel} aria-label={t.editorLabel}>
      <div className={`${panel.header} ${styles.toolbar}`}>
        <RunButton />
        <label className={styles.check} htmlFor={queryAllId} title={t.queryAllTitle}>
          <input
            id={queryAllId}
            type="checkbox"
            checked={soql.queryAll}
            disabled={noOrg || soql.tooling}
            onChange={(e) => soql.setQueryAll(e.target.checked)}
          />
          {t.queryAll}
        </label>
        <label className={styles.check} htmlFor={toolingId}>
          <input
            id={toolingId}
            type="checkbox"
            checked={soql.tooling}
            disabled={noOrg || soql.queryAll}
            onChange={(e) => soql.setTooling(e.target.checked)}
          />
          {t.tooling}
        </label>
        <span className={panel.spacer} />
        <button type="button" className={panel.button} onClick={soql.format}>
          {t.format}
        </button>
      </div>
      <SoqlEditor />
    </section>
  )
}
