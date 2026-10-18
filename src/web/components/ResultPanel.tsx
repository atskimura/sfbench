// Query results: the result table with its later pages, the row filter, the
// child records of a subquery cell, and CSV export (docs/web.md "結果の表").
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useReducer, useState } from 'react'
import { ApiRequestError, api } from '../apiClient.ts'
import { t } from '../i18n/i18n.ts'
import { pagesReducer, type Pages } from '../results/pages.ts'
import { addColumns, cellText, cellValue, type ChildRecords, type Column, type SObjectRecord } from '../results/columns.ts'
import { useOrgs } from '../state/OrgContext.tsx'
import { useResult, type QueryResult } from '../state/SoqlContext.tsx'
import { useTask } from '../state/useTask.ts'
import { FixWithAi } from './AiBar.tsx'
import { CopyCommand } from './CopyCommand.tsx'
import { ErrorDetails } from './ErrorDetails.tsx'
import { CsvExport } from './CsvExport.tsx'
import panel from './Panel.module.css'
import styles from './ResultPanel.module.css'
import { ResultTable, type CellRef } from './ResultTable.tsx'

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function ResultPanel() {
  const { result, running, cancel } = useResult()
  return (
    <section className={`${panel.panel} ${styles.result}`} aria-label={t.results} aria-busy={running}>
      {running ? (
        // Here and not on the Run button, so that clicking Run twice cannot cancel (docs/screens.md).
        <div className={styles.running}>
          <p className={panel.empty}>{t.runningQuery}</p>
          <button type="button" className={panel.button} onClick={cancel}>
            {t.cancel}
          </button>
          <p className={panel.meta}>{t.cancelRunNote}</p>
        </div>
      ) : (
        <Shown result={result} />
      )}
    </section>
  )
}

function Shown({ result }: { result: QueryResult }) {
  return (
    <>
      {result.state === 'idle' && <p className={panel.empty}>{t.noResults}</p>}
      {result.state === 'error' && (
        <div className={styles.error} role="alert">
          <p className={styles.message}>{result.message}</p>
          {result.reloginCommand && <CopyCommand command={result.reloginCommand} />}
          {result.rejected && (
            <div>
              <FixWithAi error={result.message} rejected={result.rejected} />
            </div>
          )}
          <ErrorDetails details={result.details} />
        </div>
      )}
      {/* A new run starts a new table, with new column widths, and stops what the old one was loading. */}
      {result.state === 'done' && <Records key={result.id} result={result} />}
    </>
  )
}

type Done = Extract<QueryResult, { state: 'done' }>

type Scan = { filter: string; columns: readonly Column[]; count: number; matches: readonly number[] }
/** Per result: the rows already checked, so that a new page checks only its own rows. */
const scans = new WeakMap<Done, Scan>()

/** Indices of the loaded rows of `result` with a cell containing `filter` (lower case). */
function matchingRows(result: Done, records: readonly SObjectRecord[], columns: readonly Column[], filter: string): readonly number[] {
  const loaded = records.length
  let scan = scans.get(result)
  if (!scan || scan.filter !== filter || scan.columns !== columns || scan.count > loaded) {
    scan = { filter, columns, count: 0, matches: [] }
  }
  const matches = [...scan.matches]
  for (let i = scan.count; i < loaded; i++) {
    if (columns.some((c) => cellText(cellValue(records[i], c)).toLowerCase().includes(filter))) matches.push(i)
  }
  scans.set(result, { filter, columns, count: loaded, matches })
  return matches
}
type OpenChild = { row: number; column: Column; child: ChildRecords }

/** The query locator behind nextRecordsUrl expired or was dropped: the same request can never succeed. */
function isLocatorGone(e: unknown): boolean {
  return e instanceof ApiRequestError && e.code === 'SALESFORCE_ERROR' && JSON.stringify(e.body?.details ?? '').includes('INVALID_QUERY_LOCATOR')
}

/**
 * The later pages of the shown result (docs/web.md "流れごとの指定"). The
 * reducer decides which page is taken; this fetches one page at a time.
 */
function usePages(result: Done) {
  const { reportApiUsage, reportOrgError } = useOrgs()
  const { start, running } = useTask()
  const [pages, dispatch] = useReducer(pagesReducer, result, (r): Pages => ({
    records: r.records,
    next: r.nextRecordsUrl,
    columns: r.columns,
    failure: undefined,
  }))
  const { next, failure } = pages
  // Reported once the reducer has kept it: a failure of a page fetched again is dropped there.
  useEffect(() => {
    if (failure?.kind === 'retry') reportOrgError(result.username, failure.error)
    // Each failure once, not again when the callback changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failure])
  const load = useCallback(
    async (retry = false) => {
      if (!next || (failure && !retry)) return
      // A load called with an older render's values may fetch a page again;
      // the reducer drops it, since `next` has moved on.
      const outcome = await start((signal) => api.nextPage(result.username, next, signal), 'ignore')
      if (outcome.kind === 'done') {
        const page = outcome.value
        reportApiUsage(result.username, page.apiUsage)
        dispatch({ type: 'page', from: next, records: page.records, next: page.done ? undefined : page.nextRecordsUrl })
      } else if (outcome.kind === 'error') {
        const failed = isLocatorGone(outcome.error) ? { kind: 'rerun' as const } : { kind: 'retry' as const, error: outcome.error }
        dispatch({ type: 'failed', from: next, failure: failed })
      }
    },
    // `running` too: a load ignored while another ran is asked again once that ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result.username, next, failure, running, start, reportApiUsage],
  )
  return { ...pages, load, loading: running }
}

function Records({ result }: { result: Done }) {
  const pages = usePages(result)
  const { orgs } = useOrgs()
  const instanceUrl = orgs?.find((o) => o.username === result.username)?.instanceUrl
  const [filter, setFilter] = useState('')
  const filterId = useId()
  const deferredFilter = useDeferredValue(filter.trim().toLowerCase())
  const [selected, setSelected] = useState<CellRef>()
  const [child, setChild] = useState<OpenChild>()
  const { records, columns } = pages
  const loaded = records.length

  const rows = useMemo(
    () => (deferredFilter ? matchingRows(result, records, columns, deferredFilter) : undefined),
    [result, records, columns, deferredFilter],
  )

  // COUNT() has a totalSize but no records: nothing remains without a next page.
  // totalSize can fall behind when records are added after the query ran.
  const remaining = pages.next ? Math.max(result.totalSize - loaded, 0) : 0
  const nextCount = remaining > 0 ? Math.min(result.pageSize, remaining) : result.pageSize
  return (
    <>
      <div className={panel.header}>
        <span className={styles.count}>{t.recordCount(result.totalSize)}</span>
        {pages.next && <span className={panel.meta}>{t.loadedCount(loaded)}</span>}
        <span className={panel.meta}>
          {[result.object, t.elapsed((result.elapsedMs / 1000).toFixed(2)), timeFormat.format(result.executedAt)].filter(Boolean).join(' · ')}
        </span>
        <span className={panel.spacer} />
        {/* The match count sits inside the box, so that the header does not shift while filtering. */}
        <span className={styles.filter}>
          <input
            className={panel.input}
            type="search"
            aria-label={t.filterRows}
            aria-describedby={rows ? `${filterId}-count` : undefined}
            placeholder={t.filterRows}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {rows && (
            <span id={`${filterId}-count`} className={styles.matchCount}>
              {t.matchedCount(rows.length)}
            </span>
          )}
        </span>
        <CsvExport result={result} pages={pages} />
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
          onNearEnd={rows ? undefined : pages.load}
          label={t.results}
        />
        {pages.next && (rows || pages.loading || pages.failure) && (
          <div className={styles.more}>
            {pages.loading ? (
              <span className={panel.meta}>{t.loadingMore}</span>
            ) : pages.failure?.kind === 'rerun' ? (
              <span className={panel.meta}>{t.locatorExpired}</span>
            ) : (
              <>
                {pages.failure && <span className={panel.meta}>{t.loadMoreFailed}</span>}
                <button type="button" className={panel.button} onClick={() => void pages.load(true)}>
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
