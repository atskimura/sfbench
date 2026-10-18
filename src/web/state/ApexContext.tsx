// The Apex screen's state (docs/apex.md "実行の流れ"). Inside the workspace,
// which is remade for each org: switching orgs stops waiting for the run (the
// server still finishes it and records it in the history). Written after
// RestContext; what both decide alike is in execution.ts.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { MAX_APEX_CODE, type ApexHistoryEntry } from '../../shared/api.ts'
import { needsApexConfirm, sameCode } from '../apex/confirm.ts'
import { firstLineOf, initialState, reducer, type ApexResult, type ApexSnapshot, type State } from '../apex/apexState.ts'
import { api } from '../apiClient.ts'
import { runFailed } from '../execution.ts'
import { t } from '../i18n/i18n.ts'
import { useApp } from './AppContext.tsx'
import { APEX_DRAFT_KEY, claimEditorText, saveEditorText } from './editorStorage.ts'
import { useOrgs, type Seed } from './OrgContext.tsx'
import type { EditorHandle } from './SoqlContext.tsx'
import { useTask } from './useTask.ts'

export type ApexEditorHandle = EditorHandle & {
  /** Moves the cursor to a line and column (from 1) of the code. */
  goTo: (line: number, column: number | undefined) => void
}

type ApexValue = State & {
  /** The editor's first text; the code lives in the editor from then on. */
  initialCode: string
  registerEditor: (handle: ApexEditorHandle | null) => void
  onCodeChange: (text: string) => void
  /** The first line that is not blank, for the closed code area and nothing else. */
  firstLine: string
  empty: boolean
  /** The code is no longer what the result shown was run with. */
  codeChanged: boolean
  goTo: (line: number, column: number | undefined) => void
  history: ApexHistoryEntry[]
  historyLoading: boolean
  refreshHistory: () => void
  loadEntry: (entry: ApexHistoryEntry) => void
  /** Apex is running: decided by the run task only. */
  running: boolean
  /** Runs the code, asking first when needsApexConfirm says so. */
  run: () => void
  confirmRun: () => void
  cancelConfirm: () => void
  closeNotice: () => void
  /** The --apex code was for this org and was left out. */
  apexLeftOutFor: string | undefined
}

const ApexContext = createContext<ApexValue | undefined>(undefined)

/** A run whose outcome is not known, put in the history at once (as the REST screen does). */
function localUnknown(run: ApexSnapshot): ApexHistoryEntry {
  return { id: `local-${Date.now()}`, code: run.code, sentAt: run.ranAt, outcome: { state: 'unknown', reason: 'error' } }
}

export function ApexProvider({ username, seed, children }: { username: string; seed: Seed | undefined; children: ReactNode }) {
  const { handleCommonError } = useApp()
  const { isProduction, handleOrgError, markAuthError } = useOrgs()
  // The --apex code, else the one saved for this org.
  const [initialCode] = useState(() => claimEditorText(username, seed?.apex?.code, APEX_DRAFT_KEY))
  const code = useRef(initialCode)
  const editor = useRef<ApexEditorHandle | null>(null)
  const [state, dispatch] = useReducer(reducer, Boolean(seed?.apex), initialState)
  // Drawn only when they change, not on each key.
  const [firstLine, setFirstLine] = useState(() => firstLineOf(initialCode))
  const [codeChanged, setCodeChanged] = useState(false)
  // The code the result shown was run with.
  const shownCode = useRef<string | undefined>(undefined)
  const [history, setHistory] = useState<ApexHistoryEntry[]>([])
  // Until it has been loaded once, an earlier unknown outcome cannot be told (confirm.ts).
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const { start: startRun, running } = useTask()
  const { start: startHistory, running: historyLoading } = useTask()

  const refreshHistory = useCallback(async () => {
    const outcome = await startHistory((signal) => api.apexHistory(username, signal), 'replace')
    // A failure shows nothing: the list stays as it was.
    if (outcome.kind === 'done') {
      setHistory(outcome.value.entries)
      setHistoryLoaded(true)
    }
  }, [startHistory, username])

  useEffect(() => {
    void refreshHistory()
    // Once per workspace, which is remade for each org.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const show = useCallback((result: ApexResult) => {
    shownCode.current = result.state === 'idle' ? undefined : result.run.code
    setCodeChanged(shownCode.current !== undefined && !sameCode(shownCode.current, code.current))
    dispatch({ type: 'result', result })
  }, [])

  const runNow = useCallback(
    async (text: string) => {
      // Never called while running (run does nothing then), so this run starts.
      dispatch({ type: 'running' })
      const run: ApexSnapshot = { code: text, ranAt: new Date().toISOString() }
      const outcome = await startRun((signal) => api.apex(username, { code: text }, signal), 'ignore')
      if (outcome.kind === 'stale') return
      // The server has written how it ended.
      void refreshHistory()
      if (outcome.kind === 'done') {
        show({ state: 'response', run, response: outcome.value })
        return
      }
      const e = outcome.error
      const failed = runFailed(e, true)
      if (failed.kind === 'unknown') {
        // A lost session still shows its band; the result says the outcome is unknown.
        handleCommonError(e)
        // Asked about before it runs again, even before the history is loaded again.
        setHistory((entries) => [localUnknown(run), ...entries])
        show({ state: 'unknown', run, message: t.apexUnknown })
        return
      }
      if (failed.kind === 'elsewhere') {
        handleOrgError(username, e)
        show({ state: 'idle' })
        return
      }
      if (failed.orgAuth) markAuthError(username, failed.reloginCommand)
      show({ state: 'error', run, message: failed.message, details: failed.details, reloginCommand: failed.reloginCommand })
    },
    [startRun, username, refreshHistory, show, handleCommonError, handleOrgError, markAuthError],
  )

  const run = useCallback(() => {
    // As the Run button, which cannot be pressed meanwhile.
    if (running) return
    const text = code.current
    if (!text.trim()) return
    // The server refuses it too; said here, it is not asked about first.
    if (text.length > MAX_APEX_CODE) {
      show({ state: 'error', run: { code: text, ranAt: new Date().toISOString() }, message: t.apexTooLong(MAX_APEX_CODE.toLocaleString()) })
      return
    }
    const reasons = needsApexConfirm(text, { isProduction, history, historyLoaded })
    if (reasons.length > 0) dispatch({ type: 'confirm', code: text, reasons })
    else void runNow(text)
  }, [running, isProduction, history, historyLoaded, runNow, show])

  const { confirming } = state
  const confirmRun = useCallback(() => {
    // The code as it was when Run was pressed, not the editor's now.
    if (confirming) void runNow(confirming.code)
  }, [confirming, runNow])

  const onCodeChange = useCallback(
    (text: string) => {
      code.current = text
      saveEditorText(username, text, APEX_DRAFT_KEY)
      setFirstLine(firstLineOf(text))
      setCodeChanged(shownCode.current !== undefined && !sameCode(shownCode.current, text))
    },
    [username],
  )

  const value = useMemo<ApexValue>(
    () => ({
      ...state,
      initialCode,
      registerEditor: (handle) => {
        editor.current = handle
      },
      onCodeChange,
      firstLine,
      empty: !firstLine,
      codeChanged,
      goTo: (line, column) => editor.current?.goTo(line, column),
      history,
      historyLoading,
      refreshHistory: () => void refreshHistory(),
      // Its change comes back through onCodeChange.
      loadEntry: (entry) => editor.current?.setText(entry.code),
      running,
      run,
      confirmRun,
      cancelConfirm: () => dispatch({ type: 'confirmCancelled' }),
      closeNotice: () => dispatch({ type: 'noticeClosed' }),
      apexLeftOutFor: seed?.apexLeftOutFor,
    }),
    [state, initialCode, onCodeChange, firstLine, codeChanged, history, historyLoading, refreshHistory, running, run, confirmRun, seed?.apexLeftOutFor],
  )
  return <ApexContext.Provider value={value}>{children}</ApexContext.Provider>
}

// The hook lives next to its provider; this file is not hot-reloaded as a component.
// oxlint-disable-next-line react/only-export-components
export function useApex(): ApexValue {
  const value = useContext(ApexContext)
  if (!value) throw new Error('useApex must be used inside ApexProvider')
  return value
}
