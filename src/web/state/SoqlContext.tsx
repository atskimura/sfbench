// SOQL editor state and query results (docs/web.md "状態の持ち方").
// Two contexts, so that typing in the editor does not re-render the results.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { HistoryEntry, QueryResponse } from '../../shared/api.ts'
import { ApiRequestError, api } from '../api/client.ts'
import { t } from '../i18n/i18n.ts'
import { fromObjectOf } from '../soql/completion.ts'
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
import { useApp } from './AppContext.tsx'
import { useOrgs } from './OrgContext.tsx'

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

export type QueryResult =
  | { state: 'idle' }
  | { state: 'running' }
  | {
      state: 'done'
      response: QueryResponse
      /** The FROM object, for display and the CSV file name. */
      object: string | undefined
      tooling: boolean
      elapsedMs: number
      executedAt: Date
    }
  | { state: 'error'; message: string; details?: unknown; reloginCommand?: string }

type ResultState = { result: QueryResult }

const SoqlContext = createContext<SoqlState | undefined>(undefined)
const ResultContext = createContext<ResultState | undefined>(undefined)

export function SoqlProvider({ children }: { children: ReactNode }) {
  const { settings, notify } = useApp()
  const { selected, selectedSummary, handleOrgError, markAuthError, reportApiUsage, takeLaunchQuery } = useOrgs()
  const editor = useRef<EditorHandle | null>(null)
  const [selection, setSelection] = useState<Selection>()
  const [panelObject, setPanelObject] = useState<string>()
  const [tooling, setToolingState] = useState(false)
  const [queryAll, setQueryAllState] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [result, setResult] = useState<QueryResult>({ state: 'idle' })
  const runGeneration = useRef(0)
  const runAbort = useRef<AbortController | undefined>(undefined)
  // The org whose history may be shown; a late response for another org is dropped.
  const historyOrg = useRef<string | undefined>(undefined)

  const names = useMemo<NameContext>(
    () => ({ ns: selectedSummary?.namespacePrefix, omitNamespace: settings?.omitNamespace ?? true }),
    [selectedSummary, settings],
  )

  /** Parses the text into the selection; with `switchPanel`, also shows the FROM object on the left. */
  const applyText = useCallback((text: string, switchPanel = true) => {
    const query = parseSoql(text)
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

  const loadHistoryFor = useCallback(
    (username: string) => {
      api.history(username).then(
        (h) => {
          if (historyOrg.current === username) setHistory(h.entries)
        },
        (e: unknown) => {
          if (historyOrg.current === username) handleOrgError(username, e)
        },
      )
    },
    [handleOrgError],
  )

  const run = useCallback(() => {
    if (!selected) return
    const soql = editor.current?.getText() ?? ''
    if (!soql.trim()) return
    runAbort.current?.abort()
    const abort = new AbortController()
    runAbort.current = abort
    const generation = ++runGeneration.current
    const started = performance.now()
    const useTooling = tooling
    setResult({ state: 'running' })
    api.query(selected, { soql, tooling: useTooling, queryAll: !useTooling && queryAll }, abort.signal).then(
      (response) => {
        if (generation !== runGeneration.current) return
        reportApiUsage(selected, response.apiUsage)
        setResult({
          state: 'done',
          response,
          // Parsed now, not from the 300 ms debounced selection (docs/web.md).
          object: parseSoql(soql)?.sObject ?? fromObjectOf(soql),
          tooling: useTooling,
          elapsedMs: performance.now() - started,
          executedAt: new Date(),
        })
        loadHistoryFor(selected)
      },
      (e: unknown) => {
        if (generation !== runGeneration.current) return
        if (e instanceof ApiRequestError && e.code === 'ABORTED') return
        if (e instanceof ApiRequestError && e.code === 'ORG_AUTH_ERROR') {
          // Shown in the result area only, not also as a notification.
          markAuthError(selected, e.body?.reloginCommand)
          setResult({ state: 'error', message: t.orgAuthError, reloginCommand: e.body?.reloginCommand })
          return
        }
        if (e instanceof ApiRequestError && e.code === 'SALESFORCE_ERROR') {
          setResult({ state: 'error', message: e.message, details: e.body?.details })
          return
        }
        if (handleOrgError(selected, e)) {
          setResult({ state: 'idle' })
          return
        }
        setResult({ state: 'error', message: (e as Error).message })
      },
    )
  }, [selected, tooling, queryAll, reportApiUsage, handleOrgError, markAuthError, loadHistoryFor])

  // When the org changes: drop the result, reload the history, and run the
  // query given at launch (docs/web.md "起動から作業画面まで").
  useEffect(() => {
    runAbort.current?.abort()
    runGeneration.current++
    setResult({ state: 'idle' })
    setHistory([])
    historyOrg.current = selected
    if (!selected) return
    loadHistoryFor(selected)
    const launch = takeLaunchQuery()
    if (launch) {
      setText(launch.query)
      if (launch.run) setTimeout(run, 0)
    }
    // run changes with the org; it must not retrigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const soqlValue = useMemo<SoqlState>(
    () => ({
      names,
      selection,
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
    [names, selection, panelObject, tooling, queryAll, history, applyText, setText, edit, run],
  )
  const resultValue = useMemo<ResultState>(() => ({ result }), [result])

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
