// @vitest-environment jsdom
// Switching orgs remakes the workspace (docs/web.md "非同期の流れ", "起動時のクエリ").
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
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

for (const [name, size] of [['offsetHeight', 600], ['offsetWidth', 1000]] as const) {
  Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => size })
}

const org = (alias: string): Org => ({
  username: `${alias}@example.com`,
  alias,
  instanceUrl: `https://${alias}.my.salesforce.com`,
  kind: 'sandbox',
  edition: undefined,
  isExpired: false,
  availability: 'ok',
})
const now = new Date().toISOString()

const editorText = () =>
  Array.from(document.querySelectorAll('.cm-line'))
    .map((line) => (line.querySelector('.cm-placeholder') ? '' : line.textContent))
    .join(' ')

async function switchTo(alias: string, from: string) {
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(from) }))
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: new RegExp(alias) }))
}

beforeEach(() => {
  sessionStorage.clear()
  mocked.orgs.mockResolvedValue({ orgs: [org('one'), org('two')], connectionCheck: 'done' })
  mocked.summary.mockResolvedValue({ organizationType: 'Developer Edition', isSandbox: true, namespacePrefix: null })
  mocked.settings.mockResolvedValue({ omitNamespace: true, requestTimeoutSeconds: 120 })
  mocked.sobjects.mockResolvedValue({ sobjects: [{ name: 'Account', label: 'Account', queryable: true }], fetchedAt: now })
  mocked.describe.mockResolvedValue({ name: 'Account', label: 'Account', fields: [], childRelationships: [], fetchedAt: now })
  mocked.history.mockResolvedValue({ entries: [] })
  mocked.query.mockResolvedValue({ totalSize: 1, done: true, records: [{ Id: '001', Name: 'Acme' }] })
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('org workspace', () => {
  it('shows no workspace until an org is selected', async () => {
    render(<App launch={undefined} />)
    expect(await screen.findByText(t.selectOrgFirst)).toBeTruthy()
    expect(document.querySelector('.cm-editor')).toBeNull()
  })

  it('resets the editor, Tooling API and results when the org changes', async () => {
    render(<App launch={{ org: 'one', query: 'SELECT Id FROM Account', run: true }} />)
    expect(await screen.findByText('Acme')).toBeTruthy()
    await userEvent.click(screen.getByLabelText('Tooling API'))
    await switchTo('two', 'one')
    await waitFor(() => expect(editorText()).toBe(''))
    expect((screen.getByLabelText('Tooling API') as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByText('Acme')).toBeNull()
  })

  it('does not bring back the editor text when coming back to the first org', async () => {
    render(<App launch={{ org: 'one', query: 'SELECT Id FROM Account' }} />)
    await waitFor(() => expect(editorText()).toContain('SELECT Id FROM Account'))
    await switchTo('two', 'one')
    await waitFor(() => expect(editorText()).toBe(''))
    await switchTo('one', 'two')
    await waitFor(() => expect(screen.getByRole('button', { name: /one/ })).toBeTruthy())
    expect(editorText()).toBe('')
  })

  it('keeps the workspace when the same org is chosen again', async () => {
    render(<App launch={{ org: 'one', query: 'SELECT Id FROM Account' }} />)
    await waitFor(() => expect(editorText()).toContain('SELECT Id FROM Account'))
    await switchTo('one', 'one')
    expect(editorText()).toContain('SELECT Id FROM Account')
  })

  it('restores the editor text after a reload in the same org only', async () => {
    sessionStorage.setItem('sfbench.selectedOrg', 'one@example.com')
    sessionStorage.setItem('sfbench.editor', JSON.stringify({ org: 'one@example.com', text: 'SELECT Name FROM Account' }))
    const { unmount } = render(<App launch={undefined} />)
    await waitFor(() => expect(editorText()).toContain('SELECT Name FROM Account'))
    unmount()
    sessionStorage.setItem('sfbench.selectedOrg', 'two@example.com')
    render(<App launch={undefined} />)
    await screen.findByRole('button', { name: /two/ })
    await waitFor(() => expect(document.querySelector('.cm-editor')).not.toBeNull())
    expect(editorText()).toBe('')
  })

  it('runs the launch query once under StrictMode, and not again after coming back', async () => {
    render(
      <StrictMode>
        <App launch={{ org: 'one', query: 'SELECT Id FROM Account', run: true }} />
      </StrictMode>,
    )
    expect(await screen.findByText('Acme')).toBeTruthy()
    expect(mocked.query).toHaveBeenCalledTimes(1)
    const runs = mocked.query.mock.calls.length
    await switchTo('two', 'one')
    await switchTo('one', 'two')
    await waitFor(() => expect(screen.getByRole('button', { name: /one/ })).toBeTruthy())
    await new Promise((r) => setTimeout(r, 50))
    expect(mocked.query.mock.calls.length).toBe(runs)
    expect(editorText()).toBe('')
  })
  it('stops the running query when the org changes', async () => {
    let signal: AbortSignal | undefined
    mocked.query.mockImplementation((_username, _req, s) => {
      signal = s
      return new Promise(() => {})
    })
    render(<App launch={{ org: 'one', query: 'SELECT Id FROM Account', run: true }} />)
    await waitFor(() => expect(signal).toBeDefined())
    await switchTo('two', 'one')
    expect(signal?.aborted).toBe(true)
  })

  it('shows nothing when the recent queries fail', async () => {
    mocked.history.mockRejectedValue(new ApiRequestError(401, 'ORG_AUTH_ERROR', 'expired'))
    render(<App launch={{ org: 'one' }} />)
    await waitFor(() => expect(mocked.history).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(t.orgAuthError)).toBeNull()
  })

  it('puts the launch query in without running when the launch org is not found', async () => {
    render(<App launch={{ org: 'gone', query: 'SELECT Id FROM Account', run: true }} />)
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /two/ }))
    await waitFor(() => expect(editorText()).toContain('SELECT Id FROM Account'))
    await new Promise((r) => setTimeout(r, 50))
    expect(mocked.query).not.toHaveBeenCalled()
  })

  it('does not run the launch query in another org after the first org list fails', async () => {
    mocked.orgs.mockRejectedValueOnce(new ApiRequestError(500, 'SF_CLI_ERROR', 'sf failed'))
    render(<App launch={{ org: 'one', query: 'SELECT Id FROM Account', run: true }} />)
    expect(await screen.findByText('sf failed')).toBeTruthy()
    // Closing and opening the list loads it again.
    const switcher = screen.getByRole('button', { name: t.selectOrg })
    await userEvent.click(switcher)
    await userEvent.click(switcher)
    await userEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: /two/ }))
    await waitFor(() => expect(editorText()).toContain('SELECT Id FROM Account'))
    await new Promise((r) => setTimeout(r, 50))
    expect(mocked.query).not.toHaveBeenCalled()
  })

  it('runs the launch query once when the named org is chosen after the first org list fails', async () => {
    mocked.orgs.mockRejectedValueOnce(new ApiRequestError(500, 'SF_CLI_ERROR', 'sf failed'))
    render(<App launch={{ org: 'one', query: 'SELECT Id FROM Account', run: true }} />)
    expect(await screen.findByText('sf failed')).toBeTruthy()
    const switcher = screen.getByRole('button', { name: t.selectOrg })
    await userEvent.click(switcher)
    await userEvent.click(switcher)
    await userEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: /one/ }))
    expect(await screen.findByText('Acme')).toBeTruthy()
    expect(mocked.query).toHaveBeenCalledTimes(1)
  })
})
