// @vitest-environment jsdom
// Running a query, its later pages and CSV export as tasks (docs/web.md "流れごとの指定").
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
      describe: vi.fn(),
      history: vi.fn(),
      query: vi.fn(),
      nextPage: vi.fn(),
      checkConnections: vi.fn(),
    },
  }
})

const { api } = await import('./apiClient.ts')
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
  mocked.describe.mockResolvedValue({ name: 'Account', label: 'Account', fields: [field('Id', 'Account ID', { type: 'id' })], childRelationships: [], fetchedAt: now })
  mocked.history.mockResolvedValue({ entries: [] })
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

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
    await userEvent.click(document.querySelector('.cm-content') as HTMLElement)
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
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
    const signals: (AbortSignal | undefined)[] = []
    mocked.query.mockResolvedValue({ totalSize: 6, done: false, nextRecordsUrl: '/next/1', records: rows(0, 2) })
    mocked.nextPage
      // The table's own next page: left loading, so that only CSV moves on.
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce({ totalSize: 6, done: false, nextRecordsUrl: '/next/2', records: rows(2, 2) })
      .mockImplementation((_u, _url, signal) => {
        signals.push(signal)
        return new Promise(() => {})
      })
    render(<App launch={launch} />)
    await waitFor(() => expect(mocked.nextPage).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByRole('button', { name: t.exportCsv }))
    expect(await screen.findByText(t.csvProgress(4, 6))).toBeTruthy()
    await userEvent.click(within(screen.getByRole('status')).getByRole('button', { name: t.cancel }))
    expect(signals[0]?.aborted).toBe(true)
    expect(screen.getByRole('button', { name: t.exportCsv })).toBeTruthy()
  })

  it('stops when the query runs again', async () => {
    const signals: (AbortSignal | undefined)[] = []
    mocked.query.mockResolvedValue({ totalSize: 6, done: false, nextRecordsUrl: '/next/1', records: rows(0, 2) })
    mocked.nextPage.mockImplementation((_u, _url, signal) => {
      signals.push(signal)
      return new Promise(() => {})
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
  })
})
