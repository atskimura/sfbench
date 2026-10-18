// @vitest-environment jsdom
// Editing and deleting rows of the result table (docs/edit.md "画面"), through the whole app.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Org, RecordResult } from '../shared/api.ts'

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
      recordsUpdate: vi.fn(),
      recordsDelete: vi.fn(),
    },
  }
})

const { api, ApiRequestError } = await import('./apiClient.ts')
const { App } = await import('./App.tsx')
const { t } = await import('./i18n/i18n.ts')
const { clearDescribeCache } = await import('./state/describeCache.ts')
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
const field = (name: string, type: string, updateable = true) => ({ name, label: name, type, relationshipName: null, referenceTo: [], updateable })
const row = (Id: string, Name: string, IsActive__c = false) => ({ attributes: { type: 'Account', url: '' }, Id, Name, IsActive__c, Rating: 'Hot' })
const ids = ['001000000000001AAA', '001000000000002AAA', '001000000000003AAA']
const launch = { org: 'demo', query: 'SELECT Id, Name, IsActive__c, Rating FROM Account', run: true }
const ok = (id: string): RecordResult => ({ id, success: true, errors: [] })

// jsdom lays nothing out; give elements a size so that the virtualized result table draws rows.
for (const [name, size] of [['offsetHeight', 600], ['offsetWidth', 1000]] as const) {
  Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => size })
}
// jsdom has no modal dialogs; opening one only needs to show it.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '')
}

const table = () => screen.getByRole('table', { name: t.results })
const cellOf = (rowIndex: number, column: number) => within(table()).getAllByRole('row')[rowIndex + 1].querySelectorAll('[role=cell]')[column] as HTMLElement

/** Runs the launch query and turns editing on, once the editable fields are known. */
async function startEditing(launchOptions = launch) {
  render(<App launch={launchOptions} />)
  await userEvent.click(await screen.findByRole('button', { name: t.editToggle }))
  await screen.findByRole('button', { name: t.saveChanges(0) })
  await waitFor(() => expect(screen.queryByText(t.editLoadingFields)).toBeNull())
}

/** Opens a cell's input by double click, types and keeps it. Column 0 is the selection. */
async function typeInto(rowIndex: number, column: number, label: string, text: string) {
  fireEvent.doubleClick(cellOf(rowIndex, column))
  const input = await screen.findByRole('textbox', { name: t.editCell(label) })
  await userEvent.clear(input)
  if (text) await userEvent.type(input, text)
  await userEvent.keyboard('{Enter}')
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  clearDescribeCache()
  mocked.orgs.mockResolvedValue({ orgs: [org, prod], connectionCheck: 'done' })
  mocked.summary.mockResolvedValue({ organizationType: 'Developer Edition', isSandbox: false, namespacePrefix: null })
  mocked.settings.mockResolvedValue({ omitNamespace: true, requestTimeoutSeconds: 120 })
  mocked.sobjects.mockResolvedValue({ sobjects: [{ name: 'Account', label: 'Account', queryable: true }], fetchedAt: now })
  mocked.versions.mockResolvedValue({ versions: ['66.0'] })
  mocked.describe.mockResolvedValue({
    name: 'Account',
    label: 'Account',
    fields: [field('Id', 'id', false), field('Name', 'string'), field('IsActive__c', 'boolean'), { ...field('Rating', 'picklist'), picklistValues: [{ value: 'Hot', active: true }, { value: 'Cold', active: true }] }],
    childRelationships: [],
    fetchedAt: now,
  })
  mocked.history.mockResolvedValue({ entries: [] })
  mocked.query.mockResolvedValue({ totalSize: 3, done: true, records: ids.map((id, i) => row(id, `Acme ${i + 1}`)) })
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('editing the result table', () => {
  it('saves the changed cells only, and writes the saved values into the table', async () => {
    mocked.recordsUpdate.mockResolvedValue({ results: [ok(ids[0])], apiUsage: undefined })
    await startEditing()
    await typeInto(0, 2, 'Name', 'Acme One')
    // A checkbox field flips at once.
    fireEvent.doubleClick(cellOf(0, 3))
    await userEvent.click(screen.getByRole('button', { name: t.saveChanges(1) }))
    await screen.findByText(t.savedRows(1, 0))
    expect(mocked.recordsUpdate).toHaveBeenCalledWith(
      org.username,
      { object: 'Account', records: [{ id: ids[0], fields: { Name: 'Acme One', IsActive__c: true } }], allOrNone: false },
      expect.any(AbortSignal),
    )
    expect(cellOf(0, 2).textContent).toBe('Acme One')
    expect(screen.getByRole('button', { name: t.saveChanges(0) })).toBeTruthy()
  })

  it('drops a change set back to the value the row has', async () => {
    await startEditing()
    await typeInto(1, 2, 'Name', 'Other')
    expect(screen.getByRole('button', { name: t.saveChanges(1) })).toBeTruthy()
    await typeInto(1, 2, 'Name', 'Acme 2')
    expect(screen.getByRole('button', { name: t.saveChanges(0) })).toBeTruthy()
  })

  it('keeps the changes of a row Salesforce refused, with its message', async () => {
    mocked.recordsUpdate.mockResolvedValue({
      results: [ok(ids[0]), { id: ids[1], success: false, errors: [{ statusCode: 'REQUIRED_FIELD_MISSING', message: 'Name is required', fields: ['Name'] }] }],
      apiUsage: undefined,
    })
    await startEditing()
    await typeInto(0, 2, 'Name', 'A')
    await typeInto(1, 2, 'Name', '')
    await userEvent.click(screen.getByRole('button', { name: t.saveChanges(2) }))
    await screen.findByText(t.savedRows(1, 1))
    expect(within(table()).getByRole('img', { name: t.rowError }).getAttribute('title')).toBe('Name is required (Name)')
    expect(screen.getByRole('button', { name: t.saveChanges(1) })).toBeTruthy()
    expect(mocked.recordsUpdate.mock.calls[0][1].records[1]).toEqual({ id: ids[1], fields: { Name: null } })
  })

  it('says the outcome is unknown after a timeout, and keeps the changes', async () => {
    mocked.recordsUpdate.mockRejectedValue(new ApiRequestError(504, 'SALESFORCE_TIMEOUT', 'timed out'))
    await startEditing()
    await typeInto(0, 2, 'Name', 'A')
    await userEvent.click(screen.getByRole('button', { name: t.saveChanges(1) }))
    expect(await screen.findByText(t.editsUnknown)).toBeTruthy()
    expect(screen.getByRole('button', { name: t.saveChanges(1) })).toBeTruthy()
  })

  it('asks before saving in production', async () => {
    mocked.summary.mockResolvedValue({ organizationType: 'Enterprise Edition', isSandbox: false, namespacePrefix: null })
    mocked.recordsUpdate.mockResolvedValue({ results: [ok(ids[0])], apiUsage: undefined })
    await startEditing({ ...launch, org: 'acme-prod' })
    await typeInto(0, 2, 'Name', 'A')
    await userEvent.click(screen.getByRole('button', { name: t.saveChanges(1) }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain(t.confirmSaveProduction('acme-prod', 'Account', 1))
    expect(mocked.recordsUpdate).not.toHaveBeenCalled()
    await userEvent.dblClick(within(dialog).getByRole('button', { name: t.confirmSave }))
    await screen.findByText(t.savedRows(1, 0))
    expect(mocked.recordsUpdate).toHaveBeenCalledTimes(1)
  })

  it('always asks before deleting, then takes the deleted rows off the table and the count', async () => {
    mocked.recordsDelete.mockResolvedValue({ results: [ok(ids[0]), ok(ids[2])], apiUsage: undefined })
    await startEditing()
    const boxes = within(table()).getAllByRole('checkbox', { name: t.selectRow })
    await userEvent.click(boxes[0])
    await userEvent.click(boxes[2])
    await userEvent.click(screen.getByRole('button', { name: t.deleteRows(2) }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain(t.confirmDelete('Account', 2))
    await userEvent.click(within(dialog).getByRole('button', { name: t.confirmDeleteButton }))
    await screen.findByText(t.deletedRows(2, 0))
    expect(mocked.recordsDelete).toHaveBeenCalledWith(org.username, { ids: [ids[0], ids[2]], allOrNone: false }, expect.any(AbortSignal))
    expect(within(table()).getAllByRole('row')).toHaveLength(2)
    expect(screen.getByText(t.recordCount(1))).toBeTruthy()
  })

  it('sends all or none when chosen, and remembers the choice', async () => {
    mocked.recordsUpdate.mockResolvedValue({ results: [ok(ids[0])], apiUsage: undefined })
    await startEditing()
    await userEvent.click(screen.getByRole('checkbox', { name: t.allOrNone }))
    await typeInto(0, 2, 'Name', 'A')
    await userEvent.click(screen.getByRole('button', { name: t.saveChanges(1) }))
    await screen.findByText(t.savedRows(1, 0))
    expect(mocked.recordsUpdate.mock.calls[0][1]).toMatchObject({ allOrNone: true })
    expect(localStorage.getItem('sfbench.allOrNone')).toBe('true')
  })

  it('asks before a run throws away changes not saved', async () => {
    await startEditing()
    await typeInto(0, 2, 'Name', 'A')
    await userEvent.click(screen.getByRole('button', { name: /^(Run|実行)/ }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain(t.discardMessage(1))
    await userEvent.click(within(dialog).getByRole('button', { name: t.cancel }))
    expect(mocked.query).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: /^(Run|実行)/ }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: t.discardConfirm }))
    await waitFor(() => expect(mocked.query).toHaveBeenCalledTimes(2))
  })

  it('does not run another query while a save is being sent', async () => {
    mocked.recordsUpdate.mockReturnValue(new Promise(() => {}))
    await startEditing()
    await typeInto(0, 2, 'Name', 'A')
    await userEvent.click(screen.getByRole('button', { name: t.saveChanges(1) }))
    await screen.findByText(t.savingRows(0, 1))
    await userEvent.click(screen.getByRole('button', { name: /^(Run|実行)/ }))
    expect(await screen.findByText(t.editsSending)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocked.query).toHaveBeenCalledTimes(1)
  })

  it('does not edit a result without Id', async () => {
    mocked.query.mockResolvedValue({ totalSize: 1, done: true, records: [{ attributes: { type: 'Account', url: '' }, Name: 'A' }] })
    render(<App launch={{ ...launch, query: 'SELECT Name FROM Account' }} />)
    const toggle = await screen.findByRole('button', { name: t.editToggle })
    expect((toggle as HTMLButtonElement).disabled).toBe(true)
    expect(toggle.getAttribute('title')).toBe(t.editNoId)
  })
})
