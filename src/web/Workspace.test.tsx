// @vitest-environment jsdom
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

const editorText = () =>
  Array.from(document.querySelectorAll('.cm-line'))
    .map((line) => line.textContent)
    .join(' ')

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
  mocked.describe.mockResolvedValue({
    name: 'Account',
    label: 'Account',
    fields: [field('Id', 'Account ID', { type: 'id' }), field('Name', 'Account Name'), field('Industry', 'Industry')],
    childRelationships: [{ childSObject: 'Contact', field: 'AccountId', relationshipName: 'Contacts' }],
    fetchedAt: now,
  })
  mocked.history.mockResolvedValue({ entries: [] })
  mocked.query.mockResolvedValue({ totalSize: 1, done: true, records: [{ attributes: { type: 'Account', url: '' }, Id: '001', Name: 'Acme' }] })
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('SOQL workspace', () => {
  it('picks an object, adds a field, runs the query and shows the result and history', async () => {
    render(<App launch={{ org: 'demo' }} />)
    await userEvent.click(await screen.findByRole('button', { name: /Account/ }))
    await waitFor(() => expect(editorText()).toContain('SELECT Id FROM Account'))

    const fields = await screen.findByRole('region', { name: 'Account' })
    await userEvent.click(within(fields).getByLabelText(/Account Name/))
    await waitFor(() => expect(editorText()).toContain('SELECT Id, Name FROM Account'))
    expect((within(fields).getByLabelText(/Account Name/) as HTMLInputElement).checked).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: /^(Run|実行)/ }))
    await waitFor(() => expect(mocked.query).toHaveBeenCalled())
    expect(mocked.query.mock.calls[0][1]).toEqual({ soql: expect.stringContaining('SELECT Id, Name'), tooling: false, queryAll: false })
    expect(await screen.findByText('Acme')).toBeTruthy()
    await waitFor(() => expect(mocked.history).toHaveBeenCalledTimes(2))
  })

  it('says the object and field lists are loading until they arrive', async () => {
    let objectsLoaded: (value: Awaited<ReturnType<typeof api.sobjects>>) => void = () => {}
    mocked.sobjects.mockReturnValue(new Promise((resolve) => (objectsLoaded = resolve)))
    render(<App launch={{ org: 'demo' }} />)
    await waitFor(() => expect(within(screen.getByRole('region', { name: t.sObjects })).getByText(t.loading)).toBeTruthy())
    const objects = screen.getByRole('region', { name: t.sObjects })
    objectsLoaded({ sobjects: [{ name: 'Account', label: 'Account', queryable: true }], fetchedAt: now })
    await waitFor(() => expect(within(objects).queryByText(t.loading)).toBeNull())

    let describeLoaded: (value: Awaited<ReturnType<typeof api.describe>>) => void = () => {}
    mocked.describe.mockReturnValue(new Promise((resolve) => (describeLoaded = resolve)))
    await userEvent.click(within(objects).getByRole('button', { name: /Account/ }))
    const fields = await screen.findByRole('region', { name: 'Account' })
    expect(within(fields).getByText(t.loading)).toBeTruthy()
    describeLoaded({ name: 'Account', label: 'Account', fields: [field('Id', 'Account ID', { type: 'id' })], childRelationships: [], fetchedAt: now })
    await waitFor(() => expect(within(fields).queryByText(t.loading)).toBeNull())
  })

  it('says only that the object list failed, and loading again on reload', async () => {
    mocked.sobjects.mockRejectedValueOnce(new Error('down'))
    render(<App launch={{ org: 'demo' }} />)
    await waitFor(() => expect(within(screen.getByRole('region', { name: t.sObjects })).getByText(t.loadFailed)).toBeTruthy())
    const objects = screen.getByRole('region', { name: t.sObjects })
    expect(within(objects).queryByText(t.loading)).toBeNull()
    let objectsLoaded: (value: Awaited<ReturnType<typeof api.sobjects>>) => void = () => {}
    mocked.sobjects.mockReturnValue(new Promise((resolve) => (objectsLoaded = resolve)))
    await userEvent.click(within(objects).getByRole('button', { name: t.reloadObjects }))
    expect(within(objects).getByText(t.loading)).toBeTruthy()
    expect(within(objects).queryByText(t.loadFailed)).toBeNull()
    objectsLoaded({ sobjects: [{ name: 'Account', label: 'Account', queryable: true }], fetchedAt: now })
    expect(await within(objects).findByRole('button', { name: /Account/ })).toBeTruthy()
  })

  it('runs the query given at launch', async () => {
    render(<App launch={{ org: 'demo', query: 'SELECT Id FROM Account', run: true }} />)
    await waitFor(() => expect(mocked.query).toHaveBeenCalled())
    expect(mocked.query.mock.calls[0][1].soql).toBe('SELECT Id FROM Account')
  })

  it('does not let Tooling API and Query All be on together', async () => {
    render(<App launch={{ org: 'demo' }} />)
    const queryAll = await screen.findByLabelText('Query All')
    await userEvent.click(queryAll)
    expect((screen.getByLabelText('Tooling API') as HTMLInputElement).disabled).toBe(true)
  })

  it('keeps the fields shown while FROM names an object the org does not have', async () => {
    mocked.history.mockResolvedValue({ entries: [{ soql: 'SELECT Id FROM Acco', tooling: false, queryAll: false, executedAt: now }] })
    render(<App launch={{ org: 'demo', query: 'SELECT Id FROM Account' }} />)
    await screen.findByRole('region', { name: 'Account' })
    await userEvent.click(await screen.findByTitle('SELECT Id FROM Acco'))
    await waitFor(() => expect(editorText()).toContain('SELECT Id FROM Acco'))
    await new Promise((r) => setTimeout(r, 400))
    expect(screen.getByRole('region', { name: 'Account' })).toBeTruthy()
    expect(mocked.describe.mock.calls.map((c) => c[1])).not.toContain('Acco')
  })

  it('shows a login error from a query in the result area only', async () => {
    mocked.query.mockRejectedValue(
      new ApiRequestError(401, 'ORG_AUTH_ERROR', 'expired', { code: 'ORG_AUTH_ERROR', message: 'expired', reloginCommand: 'sf org login web' }),
    )
    render(<App launch={{ org: 'demo', query: 'SELECT Id FROM Account', run: true }} />)
    expect(await screen.findByText(t.orgAuthError)).toBeTruthy()
    expect(screen.getAllByText(t.orgAuthError)).toHaveLength(1)
  })

  it('closes the field menu on Escape and on a click outside', async () => {
    render(<App launch={{ org: 'demo', query: 'SELECT Id FROM Account' }} />)
    const fields = await screen.findByRole('region', { name: 'Account' })
    const menu = await within(fields).findByRole('button', { name: t.fieldMenu })
    await userEvent.click(menu)
    expect(screen.getByRole('menu')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    await userEvent.click(menu)
    await userEvent.click(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('loads the next page near the end of the table, but only by the button while filtering', async () => {
    const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ Id: `00${from + i}`, Name: `Row ${from + i}` }))
    let answer: (value: Awaited<ReturnType<typeof api.nextPage>>) => void = () => {}
    mocked.query.mockResolvedValue({ totalSize: 6, done: false, nextRecordsUrl: '/next/1', records: page(0, 2) })
    mocked.nextPage
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
      .mockResolvedValueOnce({ totalSize: 6, done: true, records: page(4, 2) })
    render(<App launch={{ org: 'demo', query: 'SELECT Id, Name FROM Account', run: true }} />)
    // Two rows are well within 50 rows of the end, so the next page loads by itself.
    expect(await screen.findByText('Row 1')).toBeTruthy()
    await waitFor(() => expect(mocked.nextPage).toHaveBeenCalledTimes(1))
    await userEvent.type(screen.getByLabelText(t.filterRows), 'Row')
    answer({ totalSize: 6, done: false, nextRecordsUrl: '/next/2', records: page(2, 2) })
    expect(await screen.findByText('Row 3')).toBeTruthy()
    // While filtering, the next page waits for the button.
    expect(mocked.nextPage).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: t.loadMore(2) }))
    await waitFor(() => expect(mocked.nextPage).toHaveBeenCalledTimes(2))
    expect(mocked.nextPage.mock.calls[1][1]).toBe('/next/2')
    expect(await screen.findByText('Row 5')).toBeTruthy()
  })

  it('opens the child records of a subquery cell', async () => {
    mocked.query.mockResolvedValue({
      totalSize: 1,
      done: true,
      records: [{ Id: '001', Name: 'Acme', Contacts: { totalSize: 1, done: true, records: [{ Id: '003', LastName: 'Rogers' }] } }],
    })
    render(<App launch={{ org: 'demo', query: 'SELECT Id, Name, (SELECT Id, LastName FROM Contacts) FROM Account', run: true }} />)
    await userEvent.click(await screen.findByRole('button', { name: '1 rows' }))
    const child = await screen.findByRole('region', { name: 'Contacts' })
    expect(within(child).getByText('Rogers')).toBeTruthy()
    await userEvent.click(within(child).getByRole('button', { name: t.close }))
    expect(screen.queryByRole('region', { name: 'Contacts' })).toBeNull()
  })

  it('asks before loading more than 10,000 records for CSV', async () => {
    const records = Array.from({ length: 2000 }, (_, i) => ({ Id: `00${i}`, Name: `Row ${i}` }))
    mocked.query.mockResolvedValue({ totalSize: 20_000, done: false, nextRecordsUrl: '/next/1', records })
    mocked.nextPage.mockReturnValue(new Promise(() => {}))
    render(<App launch={{ org: 'demo', query: 'SELECT Id, Name FROM Account', run: true }} />)
    await userEvent.click(await screen.findByRole('button', { name: t.exportCsv }))
    // The API calls are estimated from the size of the first page.
    const dialog = screen.getByRole('dialog', { name: t.exportCsv })
    expect(within(dialog).getByText(t.csvConfirm(18_000, 9))).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: t.cancel }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: t.exportCsv })).toBeTruthy()
  })

  it('closes and opens the panels, and remembers them', async () => {
    localStorage.clear()
    const { unmount } = render(<App launch={{ org: 'demo', query: 'SELECT Id FROM Account' }} />)
    await userEvent.click(await screen.findByRole('button', { name: t.hideEditor }))
    expect(screen.getByText('SELECT Id FROM Account', { selector: 'code' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: t.hideRecent, hidden: true }))
    unmount()
    render(<App launch={{ org: 'demo' }} />)
    await userEvent.click(await screen.findByRole('button', { name: t.showEditor }))
    expect(screen.getByRole('button', { name: t.showRecent })).toBeTruthy()
    localStorage.clear()
  })

  it('does not load the next page again by itself after a failure, but retries by the button', async () => {
    mocked.query.mockResolvedValue({ totalSize: 4, done: false, nextRecordsUrl: '/next/1', records: [{ Id: '001', Name: 'Row 0' }] })
    mocked.nextPage.mockRejectedValueOnce(new Error('INVALID_QUERY_LOCATOR')).mockResolvedValueOnce({
      totalSize: 4,
      done: true,
      records: [{ Id: '002', Name: 'Row 1' }],
    })
    render(<App launch={{ org: 'demo', query: 'SELECT Id, Name FROM Account', run: true }} />)
    expect(await screen.findByText(t.loadMoreFailed)).toBeTruthy()
    await new Promise((r) => setTimeout(r, 100))
    expect(mocked.nextPage).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: t.loadMore(1) }))
    expect(await screen.findByText('Row 1')).toBeTruthy()
  })

  it('shows nothing remaining for COUNT()', async () => {
    mocked.query.mockResolvedValue({ totalSize: 50_000, done: true, records: [] })
    render(<App launch={{ org: 'demo', query: 'SELECT COUNT() FROM Account', run: true }} />)
    expect(await screen.findByText(t.recordCount(50_000))).toBeTruthy()
    expect(screen.queryByText(t.loadedCount(0))).toBeNull()
  })

  it('asks to run the query again when the rest of the result has expired', async () => {
    mocked.query.mockResolvedValue({ totalSize: 4, done: false, nextRecordsUrl: '/next/1', records: [{ Id: '001', Name: 'Row 0' }] })
    mocked.nextPage.mockRejectedValue(
      new ApiRequestError(400, 'SALESFORCE_ERROR', 'invalid query locator', {
        code: 'SALESFORCE_ERROR',
        message: 'invalid query locator',
        details: [{ errorCode: 'INVALID_QUERY_LOCATOR', message: 'invalid query locator' }],
      }),
    )
    render(<App launch={{ org: 'demo', query: 'SELECT Id, Name FROM Account', run: true }} />)
    expect(await screen.findByText(t.locatorExpired)).toBeTruthy()
    expect(screen.queryByRole('button', { name: t.loadMore(1) })).toBeNull()
  })

  it('moves the selected cell with the arrow keys and shows its full text', async () => {
    mocked.query.mockResolvedValue({ totalSize: 2, done: true, records: [{ Id: '001', Name: 'First' }, { Id: '002', Name: 'Second' }] })
    render(<App launch={{ org: 'demo', query: 'SELECT Id, Name FROM Account', run: true }} />)
    const table = await screen.findByRole('table', { name: t.results })
    ;(table.parentElement as HTMLElement).focus()
    await userEvent.keyboard('{ArrowDown}{ArrowRight}{ArrowDown}')
    expect(screen.getAllByText('Second')).toHaveLength(2)
  })
})
