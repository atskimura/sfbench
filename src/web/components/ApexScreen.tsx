// The Apex screen, laid out as the SOQL and REST API screens: the code at the
// top with the history at its right, the result and the debug log below across
// the width (docs/screens.md "Apex の画面", docs/apex.md). The code area and
// the history can be closed.
import { useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ApexHistoryEntry } from '../../shared/api.ts'
import { firstLineOf, type ApexResult } from '../apex/apexState.ts'
import { findMatches, MAX_MATCHES, userDebugOnly } from '../apex/log.ts'
import { downloadText } from '../download.ts'
import { t } from '../i18n/i18n.ts'
import { useApex } from '../state/ApexContext.tsx'
import { useApp } from '../state/AppContext.tsx'
import { useOrgs } from '../state/OrgContext.tsx'
import { PanelsProvider, usePanels } from '../state/PanelsContext.tsx'
import { ApexAiBar, ApexProposalCard, FixApexWithAi, UseApexResultWithAi } from './ApexAi.tsx'
import { ApexEditor, LogView } from './ApexCode.tsx'
import { ApiVersionSelect } from './ApiVersionSelect.tsx'
import { CollapseButton } from './CollapseButton.tsx'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { CopyButton } from './CopyButton.tsx'
import { CopyCommand } from './CopyCommand.tsx'
import { ErrorDetails } from './ErrorDetails.tsx'
import { Notice } from './Notice.tsx'
import panel from './Panel.module.css'
import { ReloadButton } from './ReloadButton.tsx'
import { Divider, Strip } from './Split.tsx'
import styles from './ApexScreen.module.css'

const timeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const ranAtFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

const APEX_PANELS = ['apexEditor', 'apexHistory'] as const
/** sf CLI's own start, added to the setting by the server (docs/apex.md "実行の経路"). */
const SF_START_SECONDS = 15
const USER_DEBUG_KEY = 'sfbench.apexUserDebugOnly'

export function ApexScreen() {
  return (
    // Remembered apart from the other screens' panels.
    <PanelsProvider storageKey="sfbench.apexPanels" names={APEX_PANELS}>
      <Layout />
    </PanelsProvider>
  )
}

function Layout() {
  const apex = useApex()
  const { open, setOpen } = usePanels()
  return (
    <div className={styles.screen}>
      <Notices />
      {/* Kept mounted while closed: the editor holds the text and its undo history. */}
      <div className={styles.top} hidden={!open.apexEditor}>
        <Code />
        {open.apexHistory ? <History /> : <Strip label={t.showApexHistory} text={t.apexHistory} onClick={() => setOpen('apexHistory', true)} />}
      </div>
      {!open.apexEditor && <ClosedCode />}
      <Divider open={open.apexEditor} showLabel={t.showApexEditor} hideLabel={t.hideApexEditor} onToggle={() => setOpen('apexEditor', !open.apexEditor)} />
      <Result />
      {apex.confirming && <Confirm />}
    </div>
  )
}

function RunButton() {
  const apex = useApex()
  return (
    <button type="button" className={`${panel.button} ${panel.primary}`} disabled={apex.running || apex.empty} onClick={apex.run}>
      {apex.running ? t.apexRunning : t.apexRun}
    </button>
  )
}

/** The closed code area: Run and the first line of the code. */
function ClosedCode() {
  const apex = useApex()
  return (
    <div className={`${panel.panel} ${styles.closedCode}`}>
      <RunButton />
      <code className={styles.firstLine}>{apex.firstLine || <span className={panel.meta}>{t.apexNoCode}</span>}</code>
    </div>
  )
}

function Notices() {
  const apex = useApex()
  const [leftOutClosed, setLeftOutClosed] = useState(false)
  return (
    <>
      {apex.launchNotice && <Notice text={t.apexLaunchNotice} onClose={apex.closeNotice} />}
      {apex.apexLeftOutFor !== undefined && !leftOutClosed && <Notice text={t.apexLeftOut(apex.apexLeftOutFor)} onClose={() => setLeftOutClosed(true)} />}
    </>
  )
}

function Code() {
  const apex = useApex()
  const [hint, setHint] = useState(false)
  useEffect(() => {
    if (!hint) return
    const timer = setTimeout(() => setHint(false), 4000)
    return () => clearTimeout(timer)
  }, [hint])
  return (
    <section className={`${panel.panel} ${styles.code}`} aria-label={t.apexEditor}>
      {/* As the SOQL editor: the AI on top, then the toolbar, then the code. */}
      <ApexAiBar />
      <ApexProposalCard />
      <div className={`${panel.header} ${styles.toolbar}`}>
        <RunButton />
        <ApiVersionSelect username={apex.username} value={apex.apiVersion} onChange={apex.setApiVersion} />
      </div>
      {hint && (
        <p className={styles.hint} role="status">
          {t.apexModEnterHint}
        </p>
      )}
      <ApexEditor initialText={apex.initialCode} onChange={apex.onCodeChange} onModEnter={() => setHint(true)} register={apex.registerEditor} />
    </section>
  )
}

function History() {
  const apex = useApex()
  return (
    <section className={`${panel.panel} ${styles.history}`} aria-label={t.apexHistory}>
      <div className={panel.header}>
        <span className={panel.title}>{t.apexHistory}</span>
        <span className={panel.spacer} />
        <ReloadButton label={t.reloadApexHistory} busy={apex.historyLoading} onClick={apex.refreshHistory} />
        <CollapseButton name="apexHistory" label={t.hideApexHistory} side="right" />
      </div>
      <div className={panel.body}>
        {apex.history.length === 0 && <p className={panel.empty}>{apex.historyLoading ? t.loading : t.apexHistoryEmpty}</p>}
        <ul className={styles.list}>
          {apex.history.map((entry) => (
            <li key={entry.id}>
              <button type="button" className={styles.item} onClick={() => apex.loadEntry(entry)} title={entry.code}>
                <code className={styles.itemCode}>{firstLineOf(entry.code)}</code>
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

function Outcome({ entry }: { entry: ApexHistoryEntry }) {
  const { outcome } = entry
  if (outcome.state === 'pending') return <span className={styles.unknownMark}>{t.apexPendingShort}</span>
  if (outcome.state === 'unknown') return <span className={styles.unknownMark}>{t.apexUnknownShort}</span>
  if (outcome.result === 'success') return <span className={styles.successMark}>{t.apexSuccess}</span>
  if (outcome.result === 'compileError') return <span className={styles.failureMark}>{t.apexCompileError}</span>
  return <span className={styles.failureMark}>{outcome.exceptionType ?? t.apexRuntimeError}</span>
}

function Result() {
  const apex = useApex()
  return (
    <section className={`${panel.panel} ${styles.result}`} aria-label={t.apexResult} aria-busy={apex.running}>
      {apex.running ? <Running /> : <Shown result={apex.result} />}
    </section>
  )
}

function Running() {
  const { settings } = useApp()
  return (
    // In the result, so that it shows with the code area closed too.
    <div className={styles.running}>
      <p className={panel.empty}>{t.apexRunningNote((settings?.requestTimeoutSeconds ?? 120) + SF_START_SECONDS)}</p>
    </div>
  )
}

function Shown({ result }: { result: ApexResult }) {
  const apex = useApex()
  const { setOpen } = usePanels()
  const goTo = (line: number, column: number | undefined) => {
    // The editor must be shown before it can take the cursor and the focus.
    flushSync(() => setOpen('apexEditor', true))
    apex.goTo(line, column)
  }
  if (result.state === 'idle') return <p className={panel.empty}>{t.apexNotRun}</p>
  if (result.state === 'unknown') {
    return (
      <div className={styles.resultBox}>
        <div className={styles.unknown} role="alert">
          {result.message}
        </div>
      </div>
    )
  }
  if (result.state === 'error') {
    return (
      <div className={styles.resultBox}>
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>{result.message}</p>
          {result.reloginCommand && <CopyCommand command={result.reloginCommand} />}
          <ErrorDetails details={result.details} />
        </div>
      </div>
    )
  }
  const { response } = result
  const position = response.line !== undefined ? t.apexPosition(response.line, response.column) : undefined
  return (
    <>
      <div className={panel.header}>
        <span className={response.result === 'success' ? styles.successMark : styles.failureMark}>
          {response.result === 'success' ? t.apexSuccess : response.result === 'compileError' ? t.apexCompileError : t.apexRuntimeError}
        </span>
        <span className={panel.meta}>
          {t.elapsed((response.elapsedMs / 1000).toFixed(2))} · {ranAtFormat.format(new Date(result.run.ranAt))}
        </span>
        {apex.codeChanged && <span className={panel.meta}>{t.apexCodeChanged}</span>}
        <span className={panel.spacer} />
        <UseApexResultWithAi />
      </div>
      {response.result !== 'success' && (
        <div className={styles.problem} role="alert">
          <p className={styles.errorMessage}>{response.result === 'compileError' ? response.compileProblem : response.exceptionMessage}</p>
          {position && (
            <button type="button" className={panel.button} aria-label={t.apexGoTo(position)} onClick={() => goTo(response.line!, response.column)}>
              {position}
            </button>
          )}
          {response.exceptionStackTrace && (
            <details>
              <summary>{t.apexStackTrace}</summary>
              <pre className={styles.stackTrace}>{response.exceptionStackTrace}</pre>
            </details>
          )}
          {response.result === 'runtimeError' && <p className={panel.meta}>{t.apexSideEffects}</p>}
          <FixApexWithAi
            code={result.run.code}
            problem={(response.result === 'compileError' ? response.compileProblem : response.exceptionMessage) ?? ''}
            {...(response.line !== undefined ? { line: response.line } : {})}
            {...(response.column !== undefined ? { column: response.column } : {})}
          />
        </div>
      )}
      {response.logsOmitted ? <p className={panel.empty}>{t.apexLogTooLarge}</p> : <Log logs={response.logs} ranAt={result.run.ranAt} />}
    </>
  )
}

function readUserDebugOnly(): boolean {
  try {
    return localStorage.getItem(USER_DEBUG_KEY) === 'true'
  } catch {
    return false
  }
}

/** The debug log: in full by default, searched in place (docs/apex.md "画面の構成"). */
function Log({ logs, ranAt }: { logs: string; ranAt: string }) {
  const [debugOnly, setDebugOnly] = useState(readUserDebugOnly)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  // Worked out once per log, toggle and query, not on each key typed in the code.
  const shown = useMemo(() => (debugOnly ? userDebugOnly(logs) : logs), [logs, debugOnly])
  const matches = useMemo(() => findMatches(shown, query), [shown, query])
  const current = matches.length === 0 ? 0 : Math.min(index, matches.length - 1)

  const toggle = (value: boolean) => {
    setDebugOnly(value)
    try {
      localStorage.setItem(USER_DEBUG_KEY, String(value))
    } catch {
      // Only remembering the toggle is lost.
    }
  }
  const step = (by: 1 | -1) => {
    if (matches.length > 0) setIndex((current + by + matches.length) % matches.length)
  }
  // The whole log, whatever is shown.
  const download = () => downloadText(logs, `apex-${ranAt.replace(/[:.]/g, '-')}.log`, 'text/plain;charset=utf-8')

  return (
    <div className={styles.log}>
      <div className={styles.logBar}>
        <span className={panel.title}>{t.apexLog}</span>
        <input
          className={`${panel.input} ${styles.search}`}
          type="search"
          aria-label={t.apexLogSearch}
          placeholder={t.apexLogSearch}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter' || e.key === 'ArrowDown') {
              e.preventDefault()
              step(e.key === 'Enter' && e.shiftKey ? -1 : 1)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              step(-1)
            }
          }}
        />
        {query && (
          <span className={panel.meta} aria-live="polite">
            {t.apexMatches(current + 1, matches.length, matches.length >= MAX_MATCHES)}
          </span>
        )}
        <button type="button" className={panel.button} aria-label={t.apexSearchPrevious} disabled={matches.length === 0} onClick={() => step(-1)}>
          ↑
        </button>
        <button type="button" className={panel.button} aria-label={t.apexSearchNext} disabled={matches.length === 0} onClick={() => step(1)}>
          ↓
        </button>
        <label className={styles.toggle}>
          <input type="checkbox" checked={debugOnly} onChange={(e) => toggle(e.target.checked)} />
          {t.apexUserDebugOnly}
        </label>
        <span className={panel.spacer} />
        <CopyButton text={shown} />
        <button type="button" className={panel.button} disabled={!logs} onClick={download}>
          {t.apexDownload}
        </button>
      </div>
      {shown ? <LogView text={shown} matches={matches} current={current} /> : <p className={panel.empty}>{debugOnly && logs ? t.apexNoUserDebug : t.apexLogEmpty}</p>}
    </div>
  )
}

function Confirm() {
  const apex = useApex()
  const { selectedOrg, selected } = useOrgs()
  const lines = apex.confirming!.reasons.map((reason) =>
    reason === 'production'
      ? t.apexConfirmProduction(selectedOrg?.alias ?? selected ?? '')
      : reason === 'unknownOutcome'
        ? t.apexConfirmUnknown
        : reason === 'otherPending'
          ? t.apexConfirmOtherPending
          : t.apexConfirmNoHistory,
  )
  return <ConfirmDialog title={t.apexConfirmTitle} message={lines.join('\n')} confirmLabel={t.apexConfirmRun} onConfirm={apex.confirmRun} onCancel={apex.cancelConfirm} />
}
