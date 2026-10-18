// Recent queries of the selected org, newest first (docs/screens.md).
import { t } from '../i18n/i18n.ts'
import { useSoql } from '../state/SoqlContext.tsx'
import { CollapseButton } from './CollapseButton.tsx'
import panel from './Panel.module.css'
import styles from './RecentPanel.module.css'

const timeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function RecentPanel() {
  const soql = useSoql()
  return (
    <section className={panel.panel} aria-label={t.recent}>
      <div className={panel.header}>
        <span className={panel.title}>{t.recent}</span>
        <span className={panel.spacer} />
        <CollapseButton name="recent" label={t.hideRecent} side="right" />
      </div>
      <div className={panel.body}>
        {soql.history.length === 0 && <p className={panel.empty}>{t.recentEmpty}</p>}
        <ul className={styles.list}>
          {soql.history.map((entry) => (
            <li key={`${entry.executedAt}\n${entry.soql}`}>
              <button type="button" className={styles.item} onClick={() => soql.loadHistory(entry)} title={entry.soql}>
                {entry.prompt && <span className={styles.prompt}>{entry.prompt}</span>}
                <span className={styles.soql}>{entry.soql}</span>
                <span className={panel.meta}>
                  {timeFormat.format(new Date(entry.executedAt))}
                  {entry.tooling && <span className={styles.chip}>{t.tooling}</span>}
                  {entry.queryAll && <span className={styles.chip}>{t.queryAll}</span>}
                  {entry.apiVersion && <span className={styles.chip}>{t.apiVersionChip(entry.apiVersion)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
