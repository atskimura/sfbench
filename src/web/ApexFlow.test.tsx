// @vitest-environment jsdom
// The Apex screen's flows (docs/apex.md "実行の流れ"), through the whole app.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_APEX_CODE, type ApexHistoryEntry, type ApexResponse, type Org } from '../shared/api.ts'

vi.mock('./apiClient.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./apiClient.ts')>()
  return {
    ...actual,
    api: {
      orgs: vi.fn(),
      summary: vi.fn(),
      openOrg: vi.fn(),
      settings: vi.fn(),
      saveSettings: vi.fn(),
      sobjects: vi.fn(),
      describe: vi.fn(),
      history: vi.fn(),
      query: vi.fn(),
      nextPage: vi.fn(),
      checkConnections: vi.fn(),
      rest: vi.fn(),
      restHistory: vi.fn(),
      apex: vi.fn(),
      apexHistory: vi.fn(),
    },
  }
})

const { api, ApiRequestError } = await import('./apiClient.ts')
const { App } = await import('./App.tsx')
const { t } = await import('./i18n/i18n.ts')
const mocked = vi.mocked(api)

const org: Org = {
  username: 'admin@demo.example.com',
  alias: 'demo',
  instanceUrl: 'https://demo.my.salesforce.com',
  kind: 'production',
  edition: 'Developer Edition',
  isExpired: false,
  availability: 'ok',
}
const prod: Org = { ...org, username: 'admin@acme.example.com', alias: 'acme-prod', edition: 'Enterprise Edition' }
const now = new Date().toISOString()
const code = "insert new Account(Name = 'A');"
const log = [
  '68.0 APEX_CODE,DEBUG;APEX_PROFILING,INFO',
  `Execute Anonymous: ${code}`,
  '16:52:14.24 (24754899)|EXECUTION_STARTED',
  '16:52:14.24 (31275249)|USER_DEBUG|[2]|DEBUG|rows 2',
  '16:52:14.31 (31416440)|CUMULATIVE_LIMIT_USAGE',
  '16:52:14.30 (31592018)|EXECUTION_FINISHED',
].join('\n')
const answer = (extra: Partial<ApexResponse> = {}): ApexResponse => ({ id: 'a1', result: 'success', logs: log, elapsedMs: 1500, ...extra })
const historyEntry = (outcome: ApexHistoryEntry['outcome'], entryCode = code): ApexHistoryEntry => ({ id: `h-${Math.random()}`, code: entryCode, sentAt: now, outcome })

/** A promise to settle by hand. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function openApex(launch: Parameters<typeof App>[0]['launch'] = { org: 'demo' }) {
  render(<App launch={launch} />)
  await userEvent.click(await screen.findByRole('button', { name: t.modeApex }))
  return screen.findByRole('textbox', { name: t.apexEditorLabel })
}

/** CodeMirror cannot be typed into on jsdom: write through its view (docs/web.md "テスト"). */
function write(text: string) {
  const view = EditorView.findFromDOM(screen.getByRole('textbox', { name: t.apexEditorLabel }))!
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }))
  return view
}

const result = () => screen.getByRole('region', { name: t.apexResult })
const historyPanel = () => screen.getByRole('region', { name: t.apexHistory })
const runButton = () => within(screen.getByRole('region', { name: t.apexEditor })).getByRole('button', { name: t.apexRun })

// jsdom has no modal dialogs; opening one only needs to show it.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '')
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  mocked.orgs.mockResolvedValue({ orgs: [org], connectionCheck: 'done' })
  mocked.summary.mockResolvedValue({ organizationType: 'Developer Edition', isSandbox: false, namespacePrefix: null })
  mocked.settings.mockResolvedValue({ omitNamespace: true, requestTimeoutSeconds: 120 })
  mocked.sobjects.mockResolvedValue({ sobjects: [], fetchedAt: now })
  mocked.history.mockResolvedValue({ entries: [] })
  mocked.restHistory.mockResolvedValue({ entries: [] })
  mocked.apexHistory.mockResolvedValue({ entries: [] })
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('Apex screen', () => {
  it('runs the code and shows the result with the whole debug log', async () => {
    mocked.apex.mockResolvedValue(answer())
    await openApex()
    write(code)
    await userEvent.click(runButton())
    expect(await within(result()).findByText(t.apexSuccess)).toBeTruthy()
    expect(within(result()).getByRole('textbox', { name: t.apexLog }).textContent).toContain('EXECUTION_STARTED')
    expect(mocked.apex).toHaveBeenCalledWith('admin@demo.example.com', { code }, expect.any(AbortSignal))
  })

  it('never runs on Cmd+Enter, and says how to run', async () => {
    await openApex()
    write(code)
    // CodeMirror's Mod is Cmd on a Mac and Ctrl elsewhere: press both, one at a time.
    const content = screen.getByRole('textbox', { name: t.apexEditorLabel })
    act(() => {
      fireEvent.keyDown(content, { key: 'Enter', metaKey: true })
      fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true })
    })
    expect(await screen.findByText(t.apexModEnterHint)).toBeTruthy()
    expect(mocked.apex).not.toHaveBeenCalled()
  })

  it('shows a compile error with a button to its place in the code', async () => {
    mocked.apex.mockResolvedValue(answer({ result: 'compileError', compileProblem: 'Variable does not exist: a', line: 2, column: 5 }))
    await openApex()
    const view = write('Integer y = 1;\nInteger x = a;')
    await userEvent.click(runButton())
    expect(await within(result()).findByText('Variable does not exist: a')).toBeTruthy()
    await userEvent.click(within(result()).getByRole('button', { name: t.apexGoTo(t.apexPosition(2, 5)) }))
    expect(view.state.selection.main.head).toBe('Integer y = 1;\n'.length + 4)
  })

  it('says when the code has changed since the result shown was run', async () => {
    mocked.apex.mockResolvedValue(answer({ result: 'runtimeError', exceptionMessage: 'System.MathException: Divide by 0', line: 1, column: 1 }))
    await openApex()
    write('Integer x = 1/0;')
    await userEvent.click(runButton())
    await within(result()).findByText('System.MathException: Divide by 0')
    expect(within(result()).getByText(t.apexSideEffects)).toBeTruthy()
    expect(within(result()).queryByText(t.apexCodeChanged)).toBeNull()
    write('Integer x = 1/1;')
    expect(within(result()).getByText(t.apexCodeChanged)).toBeTruthy()
  })

  it('shows the USER_DEBUG entries only when asked, and remembers it', async () => {
    mocked.apex.mockResolvedValue(answer())
    await openApex()
    write(code)
    await userEvent.click(runButton())
    await within(result()).findByText(t.apexSuccess)
    await userEvent.click(within(result()).getByRole('checkbox', { name: t.apexUserDebugOnly }))
    expect(within(result()).getByRole('textbox', { name: t.apexLog }).textContent).toBe('16:52:14.24 (31275249)|USER_DEBUG|[2]|DEBUG|rows 2')
    expect(localStorage.getItem('sfbench.apexUserDebugOnly')).toBe('true')
  })

  it('counts the search matches and moves between them', async () => {
    mocked.apex.mockResolvedValue(answer())
    await openApex()
    write(code)
    await userEvent.click(runButton())
    await within(result()).findByText(t.apexSuccess)
    await userEvent.type(within(result()).getByRole('searchbox', { name: t.apexLogSearch }), 'execution')
    expect(within(result()).getByText(t.apexMatches(1, 2, false))).toBeTruthy()
    await userEvent.keyboard('{Enter}')
    expect(within(result()).getByText(t.apexMatches(2, 2, false))).toBeTruthy()
    await userEvent.click(within(result()).getByRole('button', { name: t.apexSearchNext }))
    expect(within(result()).getByText(t.apexMatches(1, 2, false))).toBeTruthy()
  })

  it('keeps a run going while another screen is shown, and shows its result back on the Apex screen', async () => {
    const pending = deferred<ApexResponse>()
    mocked.apex.mockReturnValue(pending.promise)
    await openApex()
    write(code)
    await userEvent.click(runButton())
    expect(within(result()).getByText(t.apexRunningNote(135))).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: t.modeSoql }))
    pending.resolve(answer())
    await userEvent.click(screen.getByRole('button', { name: t.modeApex }))
    expect(await within(result()).findByText(t.apexSuccess)).toBeTruthy()
  })

  it('asks before running in production, and runs once', async () => {
    mocked.orgs.mockResolvedValue({ orgs: [prod], connectionCheck: 'done' })
    mocked.summary.mockResolvedValue({ organizationType: 'Enterprise Edition', isSandbox: false, namespacePrefix: null })
    mocked.apex.mockResolvedValue(answer())
    await openApex({ org: 'acme-prod' })
    write(code)
    await userEvent.click(runButton())
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain(t.apexConfirmProduction('acme-prod'))
    await userEvent.click(within(dialog).getByRole('button', { name: t.cancel }))
    expect(mocked.apex).not.toHaveBeenCalled()
    await userEvent.click(runButton())
    await userEvent.dblClick(within(await screen.findByRole('dialog')).getByRole('button', { name: t.apexConfirmRun }))
    await within(result()).findByText(t.apexSuccess)
    expect(mocked.apex).toHaveBeenCalledTimes(1)
  })

  it('says the outcome is unknown after a timeout, and asks before the same code runs again', async () => {
    mocked.apex.mockRejectedValueOnce(new ApiRequestError(504, 'SALESFORCE_TIMEOUT', 'timed out'))
    await openApex()
    write(code)
    // The history cannot be loaded again: the record put in at once is enough.
    mocked.apexHistory.mockRejectedValue(new ApiRequestError(500, 'INTERNAL_ERROR', 'boom'))
    await userEvent.click(runButton())
    expect(await within(result()).findByText(t.apexUnknown)).toBeTruthy()
    expect(within(historyPanel()).getByText(t.apexUnknownShort)).toBeTruthy()
    await userEvent.click(runButton())
    expect((await screen.findByRole('dialog')).textContent).toContain(t.apexConfirmUnknown)
    expect(mocked.apex).toHaveBeenCalledTimes(1)
  })

  it('does not take a run refused before it started for unknown', async () => {
    mocked.apex.mockRejectedValueOnce(new ApiRequestError(500, 'NOT_RUN', 'not run'))
    await openApex()
    write(code)
    await userEvent.click(runButton())
    expect(await within(result()).findByText(t.notRun)).toBeTruthy()
    expect(within(historyPanel()).queryByText(t.apexUnknownShort)).toBeNull()
    mocked.apex.mockResolvedValue(answer())
    await userEvent.click(runButton())
    await within(result()).findByText(t.apexSuccess)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks when another run is still waiting, even for other code', async () => {
    mocked.apexHistory.mockResolvedValue({ entries: [historyEntry({ state: 'pending' }, 'System.debug(1);')] })
    await openApex()
    await within(historyPanel()).findByText(t.apexPendingShort)
    write(code)
    await userEvent.click(runButton())
    expect((await screen.findByRole('dialog')).textContent).toContain(t.apexConfirmOtherPending)
  })

  it('asks while the history has never been loaded', async () => {
    mocked.apexHistory.mockRejectedValue(new ApiRequestError(500, 'INTERNAL_ERROR', 'boom'))
    await openApex()
    write(code)
    await userEvent.click(runButton())
    expect((await screen.findByRole('dialog')).textContent).toContain(t.apexConfirmNoHistory)
  })

  it('refuses code over the limit without sending it', async () => {
    await openApex()
    write('x'.repeat(MAX_APEX_CODE + 1))
    await userEvent.click(runButton())
    expect(await within(result()).findByText(t.apexTooLong(MAX_APEX_CODE.toLocaleString()))).toBeTruthy()
    expect(mocked.apex).not.toHaveBeenCalled()
  })

  it('loads a history entry into the editor as one undoable change, without running it', async () => {
    mocked.apexHistory.mockResolvedValue({ entries: [historyEntry({ state: 'done', result: 'success', elapsedMs: 1 }, 'System.debug(2);')] })
    await openApex()
    const view = write(code)
    await userEvent.click(await within(historyPanel()).findByRole('button', { name: /System\.debug\(2\);/ }))
    expect(view.state.doc.toString()).toBe('System.debug(2);')
    expect(mocked.apex).not.toHaveBeenCalled()
  })

  it('keeps the code over a reload in the same org', async () => {
    await openApex()
    write(code)
    cleanup()
    // The launch is a new one; a reload has no launch.
    const editor = await openApex(undefined)
    await waitFor(() => expect(editor.textContent).toBe(code))
  })
})

describe('--apex', () => {
  it('fills the editor and says it was not run', async () => {
    await openApex({ org: 'demo', apex: { code } })
    expect(screen.getByRole('textbox', { name: t.apexEditorLabel }).textContent).toBe(code)
    expect(screen.getByText(t.apexLaunchNotice)).toBeTruthy()
    expect(mocked.apex).not.toHaveBeenCalled()
  })

  it('opens the Apex screen first', async () => {
    render(<App launch={{ org: 'demo', apex: { code } }} />)
    expect(await screen.findByRole('textbox', { name: t.apexEditorLabel })).toBeTruthy()
  })
})
