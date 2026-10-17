// Export CSV: loads every remaining page, then saves the file
// (docs/web.md "CSV"). The pages loaded here are not added to the table.
import { useState } from 'react'
import type { ApiUsage } from '../../shared/api.ts'
import { api } from '../apiClient.ts'
import { t } from '../i18n/i18n.ts'
import { addColumns, type SObjectRecord } from '../results/columns.ts'
import { csvFileName, toCsv } from '../results/csv.ts'
import { useOrgs } from '../state/OrgContext.tsx'
import type { Pages } from '../results/pages.ts'
import type { QueryResult } from '../state/SoqlContext.tsx'
import { useTask } from '../state/useTask.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import panel from './Panel.module.css'
import styles from './ResultPanel.module.css'

/** Ask before loading more than this many remaining records. */
const CONFIRM_ABOVE = 10_000

type Done = Extract<QueryResult, { state: 'done' }>
type State = { step: 'idle' } | { step: 'confirm'; remaining: number }

/** `pages` is what the table has loaded: CSV starts from there. */
export function CsvExport({ result, pages }: { result: Done; pages: Pages }) {
  const { reportOrgError, reportApiUsage } = useOrgs()
  const [state, setState] = useState<State>({ step: 'idle' })
  // Progress is the number of records loaded so far. The table is remade for
  // each run, and this with it, so a new run stops the export (docs/web.md "流れごとの指定").
  const task = useTask<number>()

  const save = async () => {
    setState({ step: 'idle' })
    // What the table has loaded now; later pages it loads meanwhile are fetched here again.
    const { records: base, next: nextRecordsUrl, columns } = pages
    const loaded = base.length
    const { username } = result
    const outcome = await task.start(async (signal, progress) => {
      const extra: SObjectRecord[] = []
      let usage: ApiUsage | undefined
      let url = nextRecordsUrl
      progress(loaded)
      while (url) {
        const page = await api.nextPage(username, url, signal)
        usage = page.apiUsage ?? usage
        extra.push(...page.records)
        progress(loaded + extra.length)
        url = page.done ? undefined : page.nextRecordsUrl
      }
      return { extra, usage }
    }, 'ignore')
    if (outcome.kind === 'error') reportOrgError(username, outcome.error)
    if (outcome.kind !== 'done') return
    const { extra, usage } = outcome.value
    reportApiUsage(username, usage)
    download(toCsv(addColumns(columns, extra), extra.length ? base.concat(extra) : base), csvFileName(result.object))
  }

  const start = () => {
    const remaining = pages.next ? Math.max(result.totalSize - pages.records.length, 0) : 0
    if (remaining > CONFIRM_ABOVE) setState({ step: 'confirm', remaining })
    else void save()
  }

  const button = (
    <button type="button" className={panel.button} onClick={start} disabled={state.step === 'confirm'}>
      {t.exportCsv}
    </button>
  )
  if (state.step === 'confirm') {
    return (
      <>
        {button}
        <ConfirmDialog
          title={t.exportCsv}
          // Pages are as large as the first one (Salesforce sends smaller ones for wide rows).
          message={t.csvConfirm(state.remaining, Math.ceil(state.remaining / result.pageSize))}
          confirmLabel={t.csvContinue}
          onConfirm={() => void save()}
          onCancel={() => setState({ step: 'idle' })}
        />
      </>
    )
  }
  if (task.running) {
    return (
      <span className={styles.csvStatus} role="status">
        {t.csvProgress(task.progress ?? pages.records.length, result.totalSize)}
        <button type="button" className={panel.button} onClick={task.cancel}>
          {t.cancel}
        </button>
      </span>
    )
  }
  return button
}

function download(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  // Some browsers start the download later and need the link in the document and the URL alive.
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
