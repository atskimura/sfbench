// @vitest-environment jsdom
// Running a query, its later pages and CSV export as tasks (docs/web.md "流れごとの指定").
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Org } from '../shared/api.ts'

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
      versions: vi.fn(),
      describe: vi.fn(),
      history: vi.fn(),
      query: vi.fn(),
      nextPage: vi.fn(),
      checkConnections: vi.fn(),
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
const now = new Date().toISOString()
const field = (name: string, label: string, extra: Partial<{ type: string; relationshipName: string; referenceTo: string[] }> = {}) => ({
  name,
  label,
  type: extra.type ?? 'string',
  relationshipName: extra.relationshipName ?? null,
  referenceTo: extra.referenceTo ?? [],
})

// jsdom lays nothing out; give elements a size so that the virtualized result table draws rows.
for (const [name, size] of [['offsetHeight', 600], ['offsetWidth', 1000]] as const) {
  Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => size })
}

// jsdom has no modal dialogs; opening one only needs to show it.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '')
}

beforeEach(() => {
  sessionStorage.clear()
  mocked.orgs.mockResolvedValue({ orgs: [org], connectionCheck: 'done' })
  mocked.summary.mockResolvedValue({ organizationType: 'Developer Edition', isSandbox: false, namespacePrefix: null })
  mocked.settings.mockResolvedValue({ omitNamespace: true, requestTimeoutSeconds: 120 })
  mocked.sobjects.mockResolvedValue({ sobjects: [{ name: 'Account', label: 'Account', queryable: true }], fetchedAt: now })
  mocked.versions.mockResolvedValue({ versions: ['64.0', '65.0', '66.0'] })
  mocked.describe.mockResolvedValue({ name: 'Account', label: 'Account', fields: [field('Id', 'Account ID', { type: 'id' })], childRelationships: [], fetchedAt: now })
  mocked.history.mockResolvedValue({ entries: [] })
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

/** Watches downloads: CSV export saves through an object URL. */
function watchDownloads() {
  URL.createObjectURL ??= () => ''
  URL.revokeObjectURL ??= () => {}
  return vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:csv')
}

type Page = Awaited<ReturnType<typeof api.query>>
const rows = (from: number, n: number, name = 'Row') => Array.from({ length: n }, (_, i) => ({ Id: `00${from + i}`, Name: `${name} ${from + i}` }))
const launch = { org: 'demo', query: 'SELECT Id, Name FROM Account', run: true }
const results = () => screen.getByRole('region', { name: t.results })
const runButton = () => screen.getByRole('button', { name: /^(Run|実行)/ })

/** A pending call: its signal, and a way to answer it. */
function pending<T>() {
  const call = { signal: undefined as AbortSignal | undefined, answer: (_value: T) => {} }
  const promise = new Promise<T>((resolve) => (call.answer = resolve))
  return { call, promise }
}

describe('running a query', () => {
  it('shows Cancel in the result area while running, which stops the run and empties the result', async () => {
    const { call, promise } = pending<Page>()
    mocked.query.mockImplementation((_u, _r, signal) => {
      call.signal = signal
      return promise
    })
    render(<App launch={launch} />)
    expect(await within(await screen.findByRole('region', { name: t.results })).findByText(t.runningQuery)).toBeTruthy()
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(within(results()).getByRole('button', { name: t.cancel }))
    expect(call.signal?.aborted).toBe(true)
    expect(within(results()).getByText(t.noResults)).toBeTruthy()
    expect((runButton() as HTMLButtonElement).disabled).toBe(false)
    // A response that arrives anyway is not shown.
    call.answer({ totalSize: 1, done: true, records: rows(0, 1) })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText('Row 0')).toBeNull()
  })

  it('does nothing on Cmd+Enter while a query runs', async () => {
    mocked.query.mockReturnValue(new Promise(() => {}))
    render(<App launch={launch} />)
    await waitFor(() => expect(mocked.query).toHaveBeenCalledTimes(1))
    // A key event, not a click: jsdom cannot lay out CodeMirror's text.
    const content = document.querySelector('.cm-content') as HTMLElement
    fireEvent.keyDown(content, { key: 'Enter', metaKey: true })
    fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true })
    expect(mocked.query).toHaveBeenCalledTimes(1)
  })

  it('stops loading the next page of the previous result when the query runs again', async () => {
    const { call, promise } = pending<Page>()
    mocked.query
      .mockResolvedValueOnce({ totalSize: 4, done: false, nextRecordsUrl: '/next/1', records: rows(0, 2) })
      .mockResolvedValueOnce({ totalSize: 1, done: true, records: rows(0, 1, 'Again') })
    mocked.nextPage.mockImplementation((_u, _url, signal) => {
      call.signal = signal
      return promise
    })
    render(<App launch={launch} />)
    await waitFor(() => expect(mocked.nextPage).toHaveBeenCalledTimes(1))
    await userEvent.click(runButton())
    expect(await screen.findByText('Again 0')).toBeTruthy()
    expect(call.signal?.aborted).toBe(true)
    call.answer({ totalSize: 4, done: true, records: rows(2, 2) })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText('Row 2')).toBeNull()
  })
})

describe('CSV export', () => {
  it('shows how many records it has loaded, and Cancel stops it', async () => {
    const downloads = watchDownloads()
    const { call, promise } = pending<Page>()
    mocked.query.mockResolvedValue({ totalSize: 6, done: false, nextRecordsUrl: '/next/1', records: rows(0, 2) })
    mocked.nextPage
      // The table's own next page: left loading, so that only CSV moves on.
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce({ totalSize: 6, done: false, nextRecordsUrl: '/next/2', records: rows(2, 2) })
      .mockImplementation((_u, _url, signal) => {
        call.signal = signal
        return promise
      })
    render(<App launch={launch} />)
    await waitFor(() => expect(mocked.nextPage).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByRole('button', { name: t.exportCsv }))
    expect(await screen.findByText(t.csvProgress(4, 6))).toBeTruthy()
    await userEvent.click(within(screen.getByRole('status')).getByRole('button', { name: t.cancel }))
    expect(call.signal?.aborted).toBe(true)
    expect(screen.getByRole('button', { name: t.exportCsv })).toBeTruthy()
    // The last page arriving anyway does not save a file.
    call.answer({ totalSize: 6, done: true, records: rows(4, 2) })
    await new Promise((r) => setTimeout(r, 20))
    expect(downloads).not.toHaveBeenCalled()
  })

  it('stops when the query runs again', async () => {
    const downloads = watchDownloads()
    const signals: (AbortSignal | undefined)[] = []
    const answers: ((page: Page) => void)[] = []
    mocked.query.mockResolvedValue({ totalSize: 6, done: false, nextRecordsUrl: '/next/1', records: rows(0, 2) })
    mocked.nextPage.mockImplementation((_u, _url, signal) => {
      signals.push(signal)
      return new Promise((resolve) => answers.push(resolve))
    })
    render(<App launch={launch} />)
    await waitFor(() => expect(mocked.nextPage).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByRole('button', { name: t.exportCsv }))
    await waitFor(() => expect(mocked.nextPage).toHaveBeenCalledTimes(2))
    // The table's next page and the CSV export; the new result's table loads its own afterwards.
    const before = signals.slice()
    await userEvent.click(runButton())
    await waitFor(() => expect(mocked.query).toHaveBeenCalledTimes(2))
    expect(before.map((s) => s?.aborted)).toEqual([true, true])
    // Their pages arriving anyway neither add rows nor save a file.
    answers[0]({ totalSize: 6, done: true, records: rows(2, 2, 'Late') })
    answers[1]({ totalSize: 6, done: true, records: rows(2, 4, 'Late') })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText('Late 2')).toBeNull()
    expect(downloads).not.toHaveBeenCalled()
  })

  it('cannot start when the rest of the result has expired', async () => {
    mocked.query.mockResolvedValue({ totalSize: 6, done: false, nextRecordsUrl: '/next/1', records: rows(0, 2) })
    mocked.nextPage.mockRejectedValue(
      new ApiRequestError(400, 'SALESFORCE_ERROR', 'invalid', { code: 'SALESFORCE_ERROR', message: 'invalid', status: 400, details: [{ errorCode: 'INVALID_QUERY_LOCATOR' }] }),
    )
    render(<App launch={launch} />)
    expect(await screen.findByText(t.locatorExpired)).toBeTruthy()
    expect((screen.getByRole('button', { name: t.exportCsv }) as HTMLButtonElement).disabled).toBe(true)
  })
})

// docs/web.md "API バージョン"
describe('API version', () => {
  const versionSelect = () => screen.findByLabelText<HTMLSelectElement>(t.apiVersionLabel)

  it('runs the query and lists the objects on the version chosen, and keeps it over a reload in the same org', async () => {
    mocked.query.mockResolvedValue({ totalSize: 0, done: true, records: [] })
    render(<App launch={{ org: 'demo', query: 'SELECT Id FROM Account', run: false }} />)
    const select = await versionSelect()
    await within(select).findByRole('option', { name: t.apiVersionLatest('66.0') })
    await userEvent.selectOptions(select, '64.0')
    await waitFor(() => expect(mocked.sobjects.mock.calls.some((call) => call[2] === '64.0')).toBe(true))
    await userEvent.click(runButton())
    await waitFor(() => expect(mocked.query).toHaveBeenCalled())
    expect(mocked.query.mock.calls[0][1]).toMatchObject({ apiVersion: '64.0' })
    cleanup()
    // A reload has no launch.
    render(<App launch={undefined} />)
    expect((await versionSelect()).value).toBe('64.0')
  })

  it('sends no version for the latest', async () => {
    mocked.query.mockResolvedValue({ totalSize: 0, done: true, records: [] })
    render(<App launch={launch} />)
    await waitFor(() => expect(mocked.query).toHaveBeenCalled())
    expect(mocked.query.mock.calls[0][1]).not.toHaveProperty('apiVersion')
  })

  it('goes back to the version a recent query ran on, and to the latest for one without', async () => {
    mocked.history.mockResolvedValue({
      entries: [
        { soql: 'SELECT Id FROM Account', tooling: false, queryAll: false, executedAt: now, apiVersion: '65.0' },
        { soql: 'SELECT Name FROM Account', tooling: false, queryAll: false, executedAt: now },
      ],
    })
    render(<App launch={{ org: 'demo' }} />)
    const recent = await screen.findByRole('region', { name: t.recent })
    await userEvent.click(await within(recent).findByRole('button', { name: /SELECT Id FROM Account/ }))
    expect((await versionSelect()).value).toBe('65.0')
    expect(within(recent).getByText(t.apiVersionChip('65.0'))).toBeTruthy()
    await userEvent.click(within(recent).getByRole('button', { name: /SELECT Name FROM Account/ }))
    expect((await versionSelect()).value).toBe('')
  })
})
