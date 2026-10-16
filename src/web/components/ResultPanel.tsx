// Query results. This is the simple preview of PR 2b; PR 2d replaces the
// table with the full result table (docs/web.md "進め方").
import { t } from '../i18n/i18n.ts'
import { useResult } from '../state/SoqlContext.tsx'
import { CopyCommand } from './CopyCommand.tsx'
import panel from './Panel.module.css'
import styles from './ResultPanel.module.css'

const PREVIEW_ROWS = 200

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    const v = value as { totalSize?: number; records?: unknown[] }
    if (Array.isArray(v.records)) return `${v.totalSize ?? v.records.length} rows`
    return JSON.stringify(value)
  }
  return String(value)
}

/** Flattens parent relationships into Account.Name style keys (preview only). */
function flatten(record: Record<string, unknown>, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [key, value] of Object.entries(record)) {
    if (key === 'attributes') continue
    if (value && typeof value === 'object' && !Array.isArray((value as { records?: unknown }).records)) {
      flatten(value as Record<string, unknown>, `${prefix}${key}.`, out)
    } else {
      out[`${prefix}${key}`] = value
    }
  }
  return out
}

export function ResultPanel() {
  const { result } = useResult()
  return (
    <section className={`${panel.panel} ${styles.result}`} aria-label={t.results} aria-busy={result.state === 'running'}>
      {result.state === 'idle' && <p className={panel.empty}>{t.noResults}</p>}
      {result.state === 'running' && <p className={panel.empty}>{t.running}</p>}
      {result.state === 'error' && (
        <div className={styles.error} role="alert">
          <p className={styles.message}>{result.message}</p>
          {result.reloginCommand && <CopyCommand command={result.reloginCommand} />}
          {result.details !== undefined && (
            <details>
              <summary>{t.errorDetails}</summary>
              <pre className={styles.details}>{JSON.stringify(result.details, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
      {result.state === 'done' && <Preview result={result} />}
    </section>
  )
}

function Preview({ result }: { result: Extract<ReturnType<typeof useResult>['result'], { state: 'done' }> }) {
  const rows = result.response.records.slice(0, PREVIEW_ROWS).map((r) => flatten(r))
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  return (
    <>
      <div className={panel.header}>
        <span className={styles.count}>{t.recordCount(result.response.totalSize)}</span>
        <span className={panel.meta}>
          {[result.object, t.elapsed((result.elapsedMs / 1000).toFixed(2))].filter(Boolean).join(' · ')}
        </span>
      </div>
      <div className={panel.body}>
        {result.response.records.length > rows.length && (
          <p className={panel.meta}>{t.previewNote(rows.length, result.response.totalSize)}</p>
        )}
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c}>{cellText(row[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
