// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Org } from '../shared/api.ts'

vi.mock('./api/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/client.ts')>()
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

const { api } = await import('./api/client.ts')
const { App } = await import('./App.tsx')
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
})
