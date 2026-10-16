// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Org, OrgSummary } from '../shared/api.ts'

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
    },
  }
})

const { api, ApiRequestError } = await import('./api/client.ts')
const { App } = await import('./App.tsx')
const mocked = vi.mocked(api)

const prod: Org = {
  username: 'admin@acme.example.com',
  alias: 'acme-prod',
  instanceUrl: 'https://acme.my.salesforce.com',
  kind: 'production',
  edition: 'Enterprise Edition',
  isExpired: false,
  availability: 'ok',
}
const dev: Org = {
  username: 'admin@demo.example.com',
  alias: 'demo',
  instanceUrl: 'https://demo.my.salesforce.com',
  kind: 'production',
  edition: 'Developer Edition',
  isExpired: false,
  availability: 'ok',
}
const summary = (organizationType: string): OrgSummary & { apiUsage: { used: number; max: number } } => ({
  organizationType,
  isSandbox: false,
  namespacePrefix: null,
  apiUsage: { used: 12, max: 15000 },
})

beforeEach(() => {
  sessionStorage.clear()
  mocked.orgs.mockResolvedValue({ orgs: [prod, dev], connectionCheck: 'done' })
  mocked.summary.mockImplementation(async (username) =>
    summary(username === prod.username ? 'Enterprise Edition' : 'Developer Edition'),
  )
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('App', () => {
  it('selects the org given at launch and shows its edition and API usage', async () => {
    render(<App launch={{ org: 'demo' }} />)
    const orgButton = await screen.findByRole('button', { name: /demo/ })
    expect(orgButton.textContent).toContain('Developer Edition')
    expect(await screen.findByText(/API 12/)).toBeTruthy()
    expect(sessionStorage.getItem('sfbench.selectedOrg')).toBe(dev.username)
  })

  it('shows the production band for a production org', async () => {
    render(<App launch={{ org: 'acme-prod' }} />)
    await waitFor(() => expect(screen.getAllByText('acme-prod').length).toBeGreaterThan(1))
    expect(document.body.textContent).toMatch(/PRODUCTION|本番/)
  })

  it('opens the org list with a notice when the launch org is unknown', async () => {
    render(<App launch={{ org: 'nope', query: 'SELECT Id FROM Account', run: true }} />)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('nope')
    expect(within(dialog).getByText('acme-prod')).toBeTruthy()
    expect(mocked.summary).not.toHaveBeenCalled()
  })

  it('restores the selected org after a reload', async () => {
    sessionStorage.setItem('sfbench.selectedOrg', prod.username)
    render(<App launch={undefined} />)
    expect(await screen.findByRole('button', { name: /acme-prod/ })).toBeTruthy()
  })

  it('switches orgs from the list, which is reloaded when opened', async () => {
    render(<App launch={{ org: 'demo' }} />)
    await userEvent.click(await screen.findByRole('button', { name: /demo/ }))
    expect(mocked.orgs).toHaveBeenLastCalledWith(true)
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /acme-prod/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /acme-prod/ }).getAttribute('aria-expanded')).toBe('false'))
  })

  it('shows a band when the server can no longer be reached', async () => {
    mocked.orgs.mockRejectedValue(new ApiRequestError(0, 'NETWORK_ERROR', 'down'))
    render(<App launch={undefined} />)
    expect((await screen.findByRole('alert')).textContent).toContain('npx sfbench')
  })

  it('marks an org whose login expired and shows the relogin command', async () => {
    mocked.summary.mockRejectedValue(
      new ApiRequestError(409, 'ORG_AUTH_ERROR', 'expired', {
        code: 'ORG_AUTH_ERROR',
        message: 'expired',
        reloginCommand: 'sf org login web --instance-url https://demo.my.salesforce.com -a demo',
      }),
    )
    render(<App launch={{ org: 'demo' }} />)
    expect(await screen.findByText(/sf org login web --instance-url/)).toBeTruthy()
  })

  it('still selects the launch org when the list is opened during the first load', async () => {
    let release: (v: { orgs: Org[]; connectionCheck: 'done' }) => void = () => {}
    mocked.orgs.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
    render(<App launch={{ org: 'demo' }} />)
    await userEvent.click(screen.getByRole('button', { name: /組織を選択|Select an org/ }))
    release({ orgs: [prod, dev], connectionCheck: 'done' })
    await waitFor(() => expect(sessionStorage.getItem('sfbench.selectedOrg')).toBe(dev.username))
  })

  it('ignores the org saved in the tab for a new launch without an org', async () => {
    sessionStorage.setItem('sfbench.selectedOrg', prod.username)
    render(<App launch={{ query: 'SELECT Id FROM Account', run: true }} />)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/target-org/)
    expect(mocked.summary).not.toHaveBeenCalled()
  })

  it('opens the org list to show the error when the first load fails', async () => {
    mocked.orgs.mockRejectedValue(new ApiRequestError(502, 'SF_CLI_ERROR', 'sf org list failed'))
    render(<App launch={undefined} />)
    expect((await screen.findByRole('dialog')).textContent).toContain('sf org list failed')
  })

  it('hides unavailable orgs and folds orgs that need a new login', async () => {
    const gone: Org = { ...prod, username: 'gone@example.com', alias: 'gone', availability: 'unavailable' }
    const relogin: Org = {
      ...prod,
      username: 'relogin@example.com',
      alias: 'relogin',
      availability: 'authError',
      reloginCommand: 'sf org login web --instance-url https://relogin.my.salesforce.com -a relogin',
    }
    mocked.orgs.mockResolvedValue({ orgs: [prod, dev, gone, relogin], connectionCheck: 'done' })
    render(<App launch={undefined} />)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText('gone')).toBeNull()
    const folded = within(dialog).getByText(/new login|再ログイン/, { selector: 'summary' })
    expect(folded.textContent).toContain('1')
    expect(dialog.textContent).toContain('sf org login web --instance-url https://relogin.my.salesforce.com -a relogin')
  })
})
