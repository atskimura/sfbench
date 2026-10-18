// The REST API screen, laid out as the SOQL screen: the request at the top
// with the history at its right, the response below across the width
// (docs/screens.md "REST API の画面", docs/rest.md). The request area and the
// history can be closed.
import { useEffect, useMemo, useState } from 'react'
import { methodTakesBody, REST_METHODS, type RestHistoryEntry, type RestMethod } from '../../shared/api.ts'
import { t } from '../i18n/i18n.ts'
import { formatJson, responseText, sizeText } from '../rest/json.ts'
import type { RestResult } from '../rest/restState.ts'
import { useApp } from '../state/AppContext.tsx'
import { useOrgs } from '../state/OrgContext.tsx'
import { useRest } from '../state/RestContext.tsx'
import { usePanels, PanelsProvider } from '../state/PanelsContext.tsx'
import { CollapseButton } from './CollapseButton.tsx'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { CopyButton } from './CopyButton.tsx'
import { CopyCommand } from './CopyCommand.tsx'
import { ErrorDetails } from './ErrorDetails.tsx'
import { JsonEditor, JsonView } from './JsonCode.tsx'
import { Notice } from './Notice.tsx'
import panel from './Panel.module.css'
import { ReloadButton } from './ReloadButton.tsx'
import { Divider, Strip } from './Split.tsx'
import styles from './RestScreen.module.css'

const timeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const REST_PANELS = ['restRequest', 'restHistory'] as const

export function RestScreen() {
  return (
    // Remembered apart from the SOQL screen's panels.
    <PanelsProvider storageKey="sfbench.restPanels" names={REST_PANELS}>
      <Layout />
    </PanelsProvider>
  )
}

function Layout() {
  const rest = useRest()
  const { open, setOpen } = usePanels()
  return (
    <div className={styles.screen}>
      <Notices />
      {/* Kept mounted while closed: the body editor holds the text. */}
      <div className={styles.top} hidden={!open.restRequest}>
        <Request />
        {open.restHistory ? <History /> : <Strip label={t.showRestHistory} text={t.restHistory} onClick={() => setOpen('restHistory', true)} />}
      </div>
      {!open.restRequest && <ClosedRequest />}
      <Divider open={open.restRequest} showLabel={t.showRestRequest} hideLabel={t.hideRestRequest} onToggle={() => setOpen('restRequest', !open.restRequest)} />
      <Response />
      {rest.confirming && <Confirm />}
    </div>
  )
}

/** Send: in the request area, and in its closed line. */
function SendButton() {
  const rest = useRest()
  return (
    <button type="button" className={`${panel.button} ${panel.primary}`} disabled={rest.sending || !rest.path.trim()} onClick={rest.send}>
      {rest.sending ? t.restSending : t.restSend}
    </button>
  )
}

/** The closed request area: the method, the path and Send. */
function ClosedRequest() {
  const rest = useRest()
  return (
    <div className={`${panel.panel} ${styles.closedRequest}`}>
      <MethodChip method={rest.method} />
      <span className={styles.path} title={rest.path}>
        {rest.path.trim() || <span className={panel.meta}>{t.restNoPath}</span>}
      </span>
      <span className={panel.spacer} />
      <SendButton />
    </div>
  )
}

function MethodChip({ method }: { method: RestMethod }) {
  return <span className={`${styles.method} ${styles[`method${method}`]}`}>{method}</span>
}

function History() {
  const rest = useRest()
  return (
    <section className={`${panel.panel} ${styles.history}`} aria-label={t.restHistory}>
      <div className={panel.header}>
        <span className={panel.title}>{t.restHistory}</span>
        <span className={panel.spacer} />
        <ReloadButton label={t.reloadRestHistory} busy={rest.historyLoading} onClick={rest.refreshHistory} />
        <CollapseButton name="restHistory" label={t.hideRestHistory} side="right" />
      </div>
      <div className={panel.body}>
        {rest.history.length === 0 && <p className={panel.empty}>{rest.historyLoading ? t.loading : t.restHistoryEmpty}</p>}
        <ul className={styles.list}>
          {rest.history.map((entry) => (
            <li key={entry.id}>
              <button type="button" className={styles.item} onClick={() => rest.loadEntry(entry)} title={entry.path}>
                <span className={styles.itemTop}>
                  <MethodChip method={entry.method} />
                  <span className={styles.path}>{entry.path}</span>
                </span>
                <span className={panel.meta}>
                  {timeFormat.format(new Date(entry.sentAt))} <Outcome entry={entry} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Outcome({ entry }: { entry: RestHistoryEntry }) {
  const { outcome } = entry
  if (outcome.state === 'done') return <span className={statusClass(outcome.status)}>{outcome.status}</span>
  return <span className={styles.statusUnknown}>{outcome.state === 'pending' ? t.restPendingShort : t.restUnknownShort}</span>
}

function statusClass(status: number): string {
  if (status >= 500) return styles.status5
  if (status >= 400) return styles.status4
  if (status >= 300) return styles.status3
  return styles.status2
}

function Notices() {
  const rest = useRest()
  const [leftOutClosed, setLeftOutClosed] = useState(false)
  return (
    <>
      {rest.launchNotice && <Notice text={t.restLaunchNotice} onClose={rest.closeNotice} />}
      {rest.restLeftOutFor !== undefined && !leftOutClosed && <Notice text={t.restLeftOut(rest.restLeftOutFor)} onClose={() => setLeftOutClosed(true)} />}
    </>
  )
}

function Request() {
  const rest = useRest()
  const [tab, setTab] = useState<'body' | 'headers'>('body')
  const [hint, setHint] = useState<string>()
  const takesBody = methodTakesBody(rest.method)

  useEffect(() => {
    if (!hint) return
    const timer = setTimeout(() => setHint(undefined), 4000)
    return () => clearTimeout(timer)
  }, [hint])

  // Cmd+Enter never sends, even a GET: it is too easy to press by mistake (docs/rest.md "利用者と決めたこと").
  const modEnter = () => setHint(t.restModEnterHint)
  const format = () => {
    const formatted = formatJson(rest.getBody())
    if (formatted === undefined) setHint(t.restCannotFormat)
    else rest.setBody(formatted)
  }

  return (
    <section className={`${panel.panel} ${styles.request}`} aria-label={t.restRequest}>
      {/* Not a form: Enter in the path must not send (a DELETE, say). Send is the button only. */}
      <div className={styles.line}>
        <label className="visually-hidden" htmlFor="rest-method">
          {t.restMethod}
        </label>
        <select
          id="rest-method"
          className={`${styles.methodSelect} ${styles[`method${rest.method}`]}`}
          value={rest.method}
          onChange={(e) => rest.setMethod(e.target.value as RestMethod)}
        >
          {REST_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <label className="visually-hidden" htmlFor="rest-path">
          {t.restPath}
        </label>
        <input
          id="rest-path"
          className={`${panel.input} ${styles.pathInput}`}
          value={rest.path}
          placeholder={t.restPathPlaceholder}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => rest.setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              modEnter()
            }
          }}
        />
        <SendButton />
      </div>
      {hint && (
        <p className={styles.hint} role="status">
          {hint}
        </p>
      )}
      <div className={styles.tabs} role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'body'} className={styles.tab} onClick={() => setTab('body')}>
          {t.restBody}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'headers'} className={styles.tab} onClick={() => setTab('headers')}>
          {t.restHeaders}
          {rest.headers.length > 0 && <span className={styles.count}>{rest.headers.length}</span>}
        </button>
        <span className={panel.spacer} />
        {tab === 'body' && takesBody && (
          <button type="button" className={panel.button} onClick={format}>
            {t.restFormat}
          </button>
        )}
      </div>
      {/* The body editor stays mounted: it holds the text while the headers are shown. */}
      <div className={styles.tabBody} hidden={tab !== 'body'}>
        {!takesBody && <p className={styles.noBody}>{t.restNoBody(rest.method)}</p>}
        <JsonEditor
          initialText={rest.initialBody}
          label={t.restBodyLabel}
          readOnly={!takesBody}
          onChange={rest.onBodyChange}
          onModEnter={modEnter}
          register={rest.registerBody}
        />
      </div>
      {tab === 'headers' && <Headers />}
    </section>
  )
}

function Headers() {
  const rest = useRest()
  const rows = rest.headers
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => rest.setHeaders(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className={styles.tabBody}>
      <ul className={styles.headerRows}>
        {rows.map((row, i) => (
          <li key={i} className={styles.headerRow}>
            <input
              className={`${panel.input} ${styles.headerName}`}
              aria-label={t.restHeaderName}
              value={row.name}
              spellCheck={false}
              onChange={(e) => set(i, { name: e.target.value })}
            />
            <input
              className={`${panel.input} ${styles.headerValue}`}
              aria-label={t.restHeaderValue}
              value={row.value}
              spellCheck={false}
              onChange={(e) => set(i, { value: e.target.value })}
            />
            <button
              type="button"
              className={panel.button}
              aria-label={t.restRemoveHeader(row.name)}
              onClick={() => rest.setHeaders(rows.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className={panel.button} onClick={() => rest.setHeaders([...rows, { name: '', value: '' }])}>
        {t.restAddHeader}
      </button>
    </div>
  )
}

function Response() {
  const rest = useRest()
  const { result } = rest
  return (
    <section className={`${panel.panel} ${styles.response}`} aria-label={t.restResponse} aria-busy={rest.sending}>
      {rest.sending ? <Sending /> : <Result result={result} />}
    </section>
  )
}

function Sending() {
  const rest = useRest()
  const { settings } = useApp()
  return (
    <div className={styles.sending}>
      <p className={panel.empty}>{t.restSending}</p>
      {/* In the response, so that it shows with the request area closed too. */}
      {rest.sendingChangesData && <p className={panel.meta}>{t.restWaiting(settings?.requestTimeoutSeconds ?? 120)}</p>}
      {!rest.sendingChangesData && (
        <>
          <button type="button" className={panel.button} onClick={rest.cancel}>
            {t.cancel}
          </button>
          <p className={panel.meta}>{t.restCancelNote}</p>
        </>
      )}
    </div>
  )
}

function Result({ result }: { result: RestResult }) {
  const [tab, setTab] = useState<'body' | 'headers'>('body')
  if (result.state === 'idle') return <p className={panel.empty}>{t.restNotSent}</p>
  const sent = (
    <span className={styles.sent}>
      <MethodChip method={result.request.method} />
      <span className={styles.path}>{result.request.path}</span>
    </span>
  )
  if (result.state === 'unknown') {
    return (
      <div className={styles.resultBox}>
        {sent}
        <div className={styles.unknown} role="alert">
          {result.message}
        </div>
      </div>
    )
  }
  if (result.state === 'error') {
    return (
      <div className={styles.resultBox}>
        {sent}
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>{result.message}</p>
          {result.reloginCommand && <CopyCommand command={result.reloginCommand} />}
          <ErrorDetails details={result.details} />
        </div>
      </div>
    )
  }
  const { response } = result
  return (
    <>
      <div className={panel.header}>
        <span className={`${styles.statusChip} ${statusClass(response.status)}`}>{response.status}</span>
        <span className={panel.meta}>
          {t.elapsed((response.elapsedMs / 1000).toFixed(2))} · {sizeText(response.size)}
        </span>
        {sent}
        <span className={panel.spacer} />
        <div className={styles.tabs} role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'body'} className={styles.tab} onClick={() => setTab('body')}>
            {t.restBody}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'headers'} className={styles.tab} onClick={() => setTab('headers')}>
            {t.restHeaders}
          </button>
        </div>
        <CopyButton text={tab === 'body' ? response.body : headerText(response.headers)} />
      </div>
      {tab === 'body' ? <Body body={response.body} omitted={response.bodyOmitted} /> : <JsonView text={headerText(response.headers)} isJson={false} label={t.restHeaders} />}
    </>
  )
}

function headerText(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')
}

function Body({ body, omitted }: { body: string; omitted: 'binary' | 'tooLarge' | 'incomplete' | undefined }) {
  // Worked out once per body, not on each key typed in the request fields.
  const shown = useMemo(() => responseText(body), [body])
  if (omitted) {
    const message = omitted === 'binary' ? t.restBodyBinary : omitted === 'tooLarge' ? t.restBodyTooLarge : t.restBodyIncomplete
    return <p className={panel.empty}>{message}</p>
  }
  if (!body) return <p className={panel.empty}>{t.restBodyEmpty}</p>
  return (
    <>
      {shown.cut && <p className={styles.hint}>{t.restBodyCut}</p>}
      <JsonView text={shown.text} isJson={shown.json} label={t.restResponse} />
    </>
  )
}

function Confirm() {
  const rest = useRest()
  const { selectedOrg, selected } = useOrgs()
  const confirming = rest.confirming!
  const request = t.restSentRequest(confirming.request.method, confirming.request.path)
  const lines = confirming.reasons.map((reason) =>
    reason === 'production'
      ? t.restConfirmProduction(selectedOrg?.alias ?? selected ?? '', request)
      : reason === 'unknownOutcome'
        ? t.restConfirmUnknown
        : t.restConfirmNoHistory,
  )
  return (
    <ConfirmDialog
      title={t.restConfirmTitle}
      message={lines.join('\n')}
      confirmLabel={t.restConfirmSend}
      onConfirm={rest.confirmSend}
      onCancel={rest.cancelConfirm}
    />
  )
}
