// SOQL editor state and query results (docs/web.md "状態の持ち方").
// Two contexts, so that typing in the editor does not re-render the results.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { HistoryEntry } from '../../shared/api.ts'
import { ApiRequestError, api } from '../apiClient.ts'
import { t } from '../i18n/i18n.ts'
import { fromObjectOf } from '../soql/context.ts'
import {
  clearAllFields,
  formatSoql,
  initialSoql,
  parseSoql,
  selectAllFields,
  selectionOf,
  toggleField,
  toggleSubquery,
  type FieldRef,
  type NameContext,
  type Selection,
} from '../soql/selection.ts'
import { addColumns, type Column, type SObjectRecord } from '../results/columns.ts'
import { useApp } from './AppContext.tsx'
import { useOrgs, type Seed } from './OrgContext.tsx'
import { useTask } from './useTask.ts'

/** What the SOQL editor component exposes to the rest of the app. */
export type EditorHandle = {
  getText: () => string
  /** Replaces the text as one undoable change. */
  setText: (text: string) => void
  focus: () => void
}

type SoqlState = {
  names: NameContext
  /** The parsed SOQL, or undefined while it cannot be parsed or is empty. */
  selection: Selection | undefined
  /** The first line of the editor text as last parsed (shown while the editor is closed). */
  firstLine: string
  /** The object shown in the left panel (as written in FROM), or undefined for the object list. */
  panelObject: string | undefined
  tooling: boolean
  queryAll: boolean
  history: HistoryEntry[]
  registerEditor: (handle: EditorHandle | null) => void
  /** Called by the editor when its text settles (300 ms after typing stops). */
  onTextSettled: (text: string) => void
  setTooling: (on: boolean) => void
  setQueryAll: (on: boolean) => void
  showObjectList: () => void
  pickObject: (name: string) => void
  toggleField: (ref: FieldRef, childRelationship?: string) => void
  toggleSubquery: (relationshipName: string) => void
  selectAll: (fieldNames: string[]) => void
  clearAll: () => void
  format: () => void
  loadHistory: (entry: HistoryEntry) => void
  run: () => void
}

/** The result of the last run. Whether a run is going on is `running` in ResultState, not a result. */
export type QueryResult =
  | { state: 'idle' }
  | {
      state: 'done'
      /** Different for each run: the result table is remade for each result (its key). */
      id: number
      /** The records loaded so far. Later pages are pushed onto this array, not copied (docs/web.md). */
      records: SObjectRecord[]
      /**
       * How many of `records` this state covers. The array grows just before
       * the state that includes the new page; read this, not records.length,
       * together with nextRecordsUrl.
       */
      loaded: number
      columns: readonly Column[]
      totalSize: number
      /** Set while more pages remain. */
      nextRecordsUrl: string | undefined
      /** Records in the first page: Salesforce sends smaller pages for wide rows or subqueries. */
      pageSize: number
      /** The org the query ran on (the result stays with it). */
      username: string
      /** The FROM object, for display and the CSV file name. */
      object: string | undefined
      tooling: boolean
      elapsedMs: number
      executedAt: Date
    }
  | { state: 'error'; message: string; details?: unknown; reloginCommand?: string }

type ResultState = {
  result: QueryResult
  /** A query is running: decided by the run's task only (docs/web.md "流れごとの指定"). */
  running: boolean
  /** Stops the running query and empties the result. */
  cancel: () => void
  /**
   * Adds a page loaded by the result table to the shown result. The table is
   * remade for each run, so the page belongs to this result.
   */
  appendPage: (result: Extract<QueryResult, { state: 'done' }>, page: { records: SObjectRecord[]; nextRecordsUrl: string | undefined }) => void
}

const SoqlContext = createContext<SoqlState | undefined>(undefined)
const ResultContext = createContext<ResultState | undefined>(undefined)

/** The workspace of one org: it is remade for each org (docs/web.md "非同期の流れ"). */
export function SoqlProvider({ username, seed, children }: { username: string; seed: Seed | undefined; children: ReactNode }) {
  const { settings, notify } = useApp()
  const { summaries, handleOrgError, markAuthError, reportApiUsage } = useOrgs()
  const summary = summaries[username]
  const editor = useRef<EditorHandle | null>(null)
  const [selection, setSelection] = useState<Selection>()
  const [firstLine, setFirstLine] = useState('')
  const [panelObject, setPanelObject] = useState<string>()
  const [tooling, setToolingState] = useState(false)
  const [queryAll, setQueryAllState] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [result, setResult] = useState<QueryResult>({ state: 'idle' })
  const { start: startRun, running, cancel: cancelRun } = useTask()
  const resultCount = useRef(0)
  const { start: startHistory } = useTask()

  const names = useMemo<NameContext>(
    () => ({ ns: summary?.namespacePrefix, omitNamespace: settings?.omitNamespace ?? true }),
    [summary, settings],
  )

  /** Parses the text into the selection; with `switchPanel`, also shows the FROM object on the left. */
  const applyText = useCallback((text: string, switchPanel = true) => {
    const query = parseSoql(text)
    setFirstLine(text.trimStart().split('\n', 1)[0])
    if (!text.trim()) {
      setSelection(undefined)
      if (switchPanel) setPanelObject(undefined)
      return
    }
    if (!query) return
    const next = selectionOf(query, names.ns)
    setSelection(next)
    if (switchPanel) setPanelObject((current) =>
      current?.toLowerCase() === next.object.toLowerCase() ? current : next.object,
    )
  }, [names.ns])

  // The namespace arrives with the org summary; parse the text again with it,
  // leaving the left panel as the user left it.
  useEffect(() => {
    if (editor.current) applyText(editor.current.getText(), false)
  }, [applyText])

  const setText = useCallback(
    (text: string) => {
      editor.current?.setText(text)
      applyText(text)
    },
    [applyText],
  )

  const edit = useCallback(
    (change: (text: string) => string | undefined) => {
      const current = editor.current?.getText() ?? ''
      const next = change(current)
      if (next === undefined) {
        notify({ message: t.cannotParseSoql })
        return
      }
      setText(next)
    },
    [notify, setText],
  )

  const refreshHistory = useCallback(async () => {
    const outcome = await startHistory((signal) => api.history(username, signal), 'replace')
    // A failure shows nothing: the list stays as it was (docs/web.md "流れごとの指定").
    if (outcome.kind === 'done') setHistory(outcome.value.entries)
  }, [startHistory, username])

  /**
   * Runs the given text: the editor's, or the launch query before the editor
   * may exist. While a query runs, another run does nothing (the Run button is
   * disabled, and Cmd+Enter is ignored here).
   */
  const runSoql = useCallback(
    async (soql: string) => {
      if (!soql.trim()) return
      const started = performance.now()
      const useTooling = tooling
      const outcome = await startRun(
        (signal) => api.query(username, { soql, tooling: useTooling, queryAll: !useTooling && queryAll }, signal),
        'ignore',
      )
      if (outcome.kind === 'stale') return
      if (outcome.kind === 'done') {
        const response = outcome.value
        reportApiUsage(username, response.apiUsage)
        setResult({
          state: 'done',
          id: ++resultCount.current,
          records: response.records,
          loaded: response.records.length,
          columns: addColumns([], response.records),
          totalSize: response.totalSize,
          nextRecordsUrl: response.done ? undefined : response.nextRecordsUrl,
          pageSize: Math.max(response.records.length, 1),
          username,
          // Parsed now, not from the 300 ms debounced selection (docs/web.md).
          object: parseSoql(soql)?.sObject ?? fromObjectOf(soql),
          tooling: useTooling,
          elapsedMs: performance.now() - started,
          executedAt: new Date(),
        })
        void refreshHistory()
        return
      }
      const e = outcome.error
      if (e instanceof ApiRequestError && e.code === 'ORG_AUTH_ERROR') {
        // Shown in the result area only, not also as a notification.
        markAuthError(username, e.body?.reloginCommand)
        setResult({ state: 'error', message: t.orgAuthError, reloginCommand: e.body?.reloginCommand })
      } else if (e instanceof ApiRequestError && e.code === 'SALESFORCE_ERROR') {
        setResult({ state: 'error', message: e.message, details: e.body?.details })
      } else if (handleOrgError(username, e)) {
        setResult({ state: 'idle' })
      } else {
        setResult({ state: 'error', message: (e as Error).message })
      }
    },
    [startRun, username, tooling, queryAll, reportApiUsage, handleOrgError, markAuthError, refreshHistory],
  )
  const run = useCallback(() => void runSoql(editor.current?.getText() ?? ''), [runSoql])

  // The workspace is remade for each org (docs/web.md "非同期の流れ"): on
  // mounting, load the history and run the launch query.
  useEffect(() => {
    void refreshHistory()
    // Run just after rendering, not here: StrictMode runs this effect, its
    // cleanup and the effect again, and the cleanup clears the first timer
    // before it fires, so the launch query runs once (docs/web.md "起動時のクエリ").
    // The editor starts with the same query (docs/web.md "起動時のクエリ").
    const timer = seed?.run ? setTimeout(() => void runSoql(seed.query), 0) : undefined
    // The run's task stops the running query when the workspace goes away.
    return () => clearTimeout(timer)
    // Once per workspace, which is remade for each org.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const soqlValue = useMemo<SoqlState>(
    () => ({
      names,
      selection,
      firstLine,
      panelObject,
      tooling,
      queryAll,
      history,
      registerEditor: (handle) => {
        editor.current = handle
        if (handle) applyText(handle.getText())
      },
      onTextSettled: (text) => applyText(text),
      setTooling: (on) => {
        setToolingState(on)
        if (on) setQueryAllState(false)
      },
      setQueryAll: (on) => {
        setQueryAllState(on)
        if (on) setToolingState(false)
      },
      showObjectList: () => setPanelObject(undefined),
      pickObject: (name) => setText(initialSoql(name, names)),
      toggleField: (ref, child) => edit((text) => toggleField(text, ref, names, child)),
      toggleSubquery: (rel) => edit((text) => toggleSubquery(text, rel, names)),
      selectAll: (fieldNames) => edit((text) => selectAllFields(text, fieldNames, names)),
      clearAll: () => edit(clearAllFields),
      format: () => edit(formatSoql),
      loadHistory: (entry) => {
        setText(entry.soql)
        setToolingState(entry.tooling)
        setQueryAllState(!entry.tooling && entry.queryAll)
      },
      run,
    }),
    [names, selection, firstLine, panelObject, tooling, queryAll, history, applyText, setText, edit, run],
  )
  const cancel = useCallback(() => {
    cancelRun()
    setResult({ state: 'idle' })
  }, [cancelRun])
  const appendPage = useCallback<ResultState['appendPage']>((shown, page) => {
    // The records array of that result grows in place (docs/web.md); `loaded`
    // says how much of it the result covers. Only that result takes the page.
    shown.records.push(...page.records)
    const loaded = shown.records.length
    setResult((prev) =>
      prev.state === 'done' && prev.id === shown.id
        ? { ...prev, loaded, columns: addColumns(prev.columns, page.records), nextRecordsUrl: page.nextRecordsUrl }
        : prev,
    )
  }, [])
  const resultValue = useMemo<ResultState>(() => ({ result, running, cancel, appendPage }), [result, running, cancel, appendPage])

  return (
    <SoqlContext.Provider value={soqlValue}>
      <ResultContext.Provider value={resultValue}>{children}</ResultContext.Provider>
    </SoqlContext.Provider>
  )
}

// The hooks live next to their providers; this file is not hot-reloaded as a component.
// oxlint-disable-next-line react/only-export-components
export function useSoql(): SoqlState {
  const value = useContext(SoqlContext)
  if (!value) throw new Error('useSoql must be used inside SoqlProvider')
  return value
}

// oxlint-disable-next-line react/only-export-components
export function useResult(): ResultState {
  const value = useContext(ResultContext)
  if (!value) throw new Error('useResult must be used inside SoqlProvider')
  return value
}
