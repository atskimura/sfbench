// Export CSV: loads every remaining page, then saves the file
// (docs/web.md "CSV"). The pages loaded here are not added to the table.
import { useEffect, useRef, useState } from 'react'
import { api } from '../apiClient.ts'
import { t } from '../i18n/i18n.ts'
import { addColumns, type SObjectRecord } from '../results/columns.ts'
import { csvFileName, toCsv } from '../results/csv.ts'
import { useOrgs } from '../state/OrgContext.tsx'
import type { QueryResult } from '../state/SoqlContext.tsx'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import panel from './Panel.module.css'
import styles from './ResultPanel.module.css'

/** Ask before loading more than this many remaining records. */
const CONFIRM_ABOVE = 10_000

type Done = Extract<QueryResult, { state: 'done' }>
type State = { step: 'idle' } | { step: 'confirm'; remaining: number } | { step: 'loading'; loaded: number }

export function CsvExport({ result }: { result: Done }) {
  const { reportOrgError, reportApiUsage } = useOrgs()
  const [state, setState] = useState<State>({ step: 'idle' })
  const abort = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => abort.current?.abort(), [])

  const save = async () => {
    // What the table has loaded now; later pages it loads meanwhile are fetched here again.
    // `loaded` and nextRecordsUrl describe the same point; records may already hold a newer page.
    const { loaded } = result
    const base = result.records.slice(0, loaded)
    let url = result.nextRecordsUrl
    const extra: SObjectRecord[] = []
    const controller = new AbortController()
    abort.current = controller
    setState({ step: 'loading', loaded })
    try {
      while (url) {
        const page = await api.nextPage(result.username, url, controller.signal)
        reportApiUsage(result.username, page.apiUsage)
        extra.push(...page.records)
        setState({ step: 'loading', loaded: loaded + extra.length })
        url = page.done ? undefined : page.nextRecordsUrl
      }
    } catch (e) {
      // Cancelled, or failed: the loaded pages are dropped.
      if (!controller.signal.aborted) reportOrgError(result.username, e)
      setState({ step: 'idle' })
      return
    }
    const records = extra.length ? base.concat(extra) : base
    download(toCsv(addColumns(result.columns, extra), records), csvFileName(result.object))
    setState({ step: 'idle' })
  }

  const start = () => {
    const remaining = result.nextRecordsUrl ? Math.max(result.totalSize - result.loaded, 0) : 0
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
  if (state.step === 'loading') {
    return (
      <span className={styles.csvStatus} role="status">
        {t.csvProgress(state.loaded, result.totalSize)}
        <button type="button" className={panel.button} onClick={() => abort.current?.abort()}>
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
