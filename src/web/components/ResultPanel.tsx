// Query results: the result table with its later pages, the row filter, the
// child records of a subquery cell, and CSV export (docs/web.md "結果の表").
import { useDeferredValue, useMemo, useState } from 'react'
import { t } from '../i18n/i18n.ts'
import { addColumns, cellText, cellValue, type ChildRecords, type Column, type SObjectRecord } from '../results/columns.ts'
import { useOrgs } from '../state/OrgContext.tsx'
import { useResult, type QueryResult } from '../state/SoqlContext.tsx'
import { CopyCommand } from './CopyCommand.tsx'
import { CsvExport } from './CsvExport.tsx'
import panel from './Panel.module.css'
import styles from './ResultPanel.module.css'
import { ResultTable, type CellRef } from './ResultTable.tsx'

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

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
      {/* A new run starts a new table, with new column widths. */}
      {result.state === 'done' && <Records key={result.executedAt.getTime()} result={result} />}
    </section>
  )
}

type Done = Extract<QueryResult, { state: 'done' }>

type Scan = { filter: string; columns: readonly Column[]; count: number; matches: readonly number[] }
/** Per result: the rows already checked, so that a new page checks only its own rows. */
const scans = new WeakMap<readonly SObjectRecord[], Scan>()

/** Indices of the loaded rows with a cell containing `filter` (lower case). */
function matchingRows(records: readonly SObjectRecord[], columns: readonly Column[], loaded: number, filter: string): readonly number[] {
  let scan = scans.get(records)
  if (!scan || scan.filter !== filter || scan.columns !== columns || scan.count > loaded) {
    scan = { filter, columns, count: 0, matches: [] }
  }
  const matches = [...scan.matches]
  for (let i = scan.count; i < loaded; i++) {
    if (columns.some((c) => cellText(cellValue(records[i], c)).toLowerCase().includes(filter))) matches.push(i)
  }
  scans.set(records, { filter, columns, count: loaded, matches })
  return matches
}
type OpenChild = { row: number; column: Column; child: ChildRecords }

function Records({ result }: { result: Done }) {
  const { loadNext } = useResult()
  const { orgs } = useOrgs()
  const instanceUrl = orgs?.find((o) => o.username === result.username)?.instanceUrl
  const [filter, setFilter] = useState('')
  const deferredFilter = useDeferredValue(filter.trim().toLowerCase())
  const [selected, setSelected] = useState<CellRef>()
  const [child, setChild] = useState<OpenChild>()
  const { records, columns } = result
  const { loaded } = result

  const rows = useMemo(
    () => (deferredFilter ? matchingRows(records, columns, loaded, deferredFilter) : undefined),
    [records, columns, loaded, deferredFilter],
  )

  // COUNT() has a totalSize but no records: nothing remains without a next page.
  // totalSize can fall behind when records are added after the query ran.
  const remaining = result.nextRecordsUrl ? Math.max(result.totalSize - loaded, 0) : 0
  const nextCount = remaining > 0 ? Math.min(result.pageSize, remaining) : result.pageSize
  return (
    <>
      <div className={panel.header}>
        <span className={styles.count}>{t.recordCount(result.totalSize)}</span>
        {result.nextRecordsUrl && <span className={panel.meta}>{t.loadedCount(loaded)}</span>}
        <span className={panel.meta}>
          {[result.object, t.elapsed((result.elapsedMs / 1000).toFixed(2)), timeFormat.format(result.executedAt)].filter(Boolean).join(' · ')}
        </span>
        <span className={panel.spacer} />
        <input
          className={`${panel.input} ${styles.filter}`}
          type="search"
          aria-label={t.filterRows}
          placeholder={t.filterRows}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {rows && <span className={panel.meta}>{t.matchedCount(rows.length)}</span>}
        <CsvExport result={result} />
      </div>
      <div className={styles.body}>
        <ResultTable
          records={records}
          loaded={loaded}
          rows={rows}
          columns={columns}
          instanceUrl={instanceUrl}
          selected={selected}
          onSelect={setSelected}
          onOpenChild={(row, column, value) => setChild({ row, column, child: value })}
          // While filtering, later pages load only by the button below (docs/web.md).
          onNearEnd={rows ? undefined : loadNext}
          label={t.results}
        />
        {result.nextRecordsUrl && (rows || result.loadingNext || result.nextFailed) && (
          <div className={styles.more}>
            {result.loadingNext ? (
              <span className={panel.meta}>{t.loadingMore}</span>
            ) : result.nextFailed === 'rerun' ? (
              <span className={panel.meta}>{t.locatorExpired}</span>
            ) : (
              <>
                {result.nextFailed && <span className={panel.meta}>{t.loadMoreFailed}</span>}
                <button type="button" className={panel.button} onClick={() => loadNext(true)}>
                  {t.loadMore(nextCount)}
                </button>
              </>
            )}
          </div>
        )}
        {selected && <CellDetail records={records} cell={selected} />}
        {child && (
          <ChildTable
            key={`${child.row}\n${child.column.key}`}
            open={child}
            instanceUrl={instanceUrl}
            onClose={() => setChild(undefined)}
          />
        )}
      </div>
    </>
  )
}

/** The full text of the selected cell, which the table cuts off. */
function CellDetail({ records, cell }: { records: readonly SObjectRecord[]; cell: CellRef }) {
  const text = cellText(cellValue(records[cell.row], cell.column))
  return (
    <div className={styles.detail}>
      <span className={`${panel.meta} ${panel.mono}`}>{cell.column.key}</span>
      <span className={styles.detailText}>{text}</span>
    </div>
  )
}

function ChildTable({ open, instanceUrl, onClose }: { open: OpenChild; instanceUrl: string | undefined; onClose: () => void }) {
  const columns = useMemo(() => addColumns([], open.child.records), [open.child.records])
  const [selected, setSelected] = useState<CellRef>()
  return (
    <section className={styles.childPanel} aria-label={open.column.key}>
      <div className={panel.header}>
        <span className={styles.count}>{t.childRecordsTitle(open.column.key, open.row + 1)}</span>
        <span className={panel.meta}>{t.recordCount(open.child.totalSize)}</span>
        {open.child.records.length < open.child.totalSize && <span className={panel.meta}>{t.childFirstPageOnly}</span>}
        <span className={panel.spacer} />
        <button type="button" className={panel.button} onClick={onClose}>
          {t.close}
        </button>
      </div>
      <ResultTable
        records={open.child.records}
        columns={columns}
        instanceUrl={instanceUrl}
        selected={selected}
        onSelect={setSelected}
        label={open.column.key}
      />
      {selected && <CellDetail records={open.child.records} cell={selected} />}
    </section>
  )
}
