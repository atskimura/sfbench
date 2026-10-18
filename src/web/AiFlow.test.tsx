// @vitest-environment jsdom
// The AI flows of docs/ai.md "画面の状態と遷移", through the whole app.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry, Org } from '../shared/api.ts'

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
      aiGenerate: vi.fn(),
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
const ready = { provider: 'anthropic' as const, model: 'claude-x', hasApiKey: true, keyProvider: 'anthropic' as const }
const answer = (soql: string, explanation = 'x') => ({ output: { soql, explanation } })
/** The AI chooses `objects`, then writes (or fixes) `soql`. */
const replies = (soql: string, explanation = 'x', objects = ['Account']) =>
  mocked.aiGenerate.mockImplementation((async (req: { task: string }) =>
    req.task === 'chooseObjects' ? { output: { objects } } : answer(soql, explanation)) as never)
const rejected = (message: string) => new ApiRequestError(400, 'SALESFORCE_ERROR', message, { code: 'SALESFORCE_ERROR', message })

/** A promise to settle by hand. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((res) => (resolve = res))
  return { promise, resolve }
}

/** Opens the demo org with Account open on the left and asks the AI. */
async function ask(request: string, query = 'SELECT Id FROM Account') {
  render(<App launch={{ org: 'demo', query }} />)
  await screen.findByRole('region', { name: 'Account' })
  await userEvent.type(await screen.findByLabelText(t.aiRequestLabel), request)
  await userEvent.click(screen.getByRole('button', { name: t.aiGenerate }))
}

const card = () => screen.findByRole('region', { name: t.aiProposal })
const lastQuery = () => mocked.query.mock.calls.at(-1)?.[1]
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
  mocked.settings.mockResolvedValue({ omitNamespace: true, requestTimeoutSeconds: 120, ai: ready })
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

describe('AI', () => {
  it('offers to set up AI until it is set up, and hides it when Off', async () => {
    mocked.settings.mockResolvedValue({ omitNamespace: true, requestTimeoutSeconds: 120 })
    const { unmount } = render(<App launch={{ org: 'demo' }} />)
    expect(await screen.findByRole('button', { name: t.aiSetUp })).toBeTruthy()
    unmount()
    mocked.settings.mockResolvedValue({ omitNamespace: true, requestTimeoutSeconds: 120, ai: { ...ready, provider: 'off' } })
    render(<App launch={{ org: 'demo' }} />)
    await screen.findByRole('button', { name: /Account/ })
    expect(screen.queryByLabelText(t.aiRequestLabel)).toBeNull()
    expect(screen.queryByRole('button', { name: t.aiSetUp })).toBeNull()
  })

  it('shows nothing about AI while the settings are loading', async () => {
    mocked.settings.mockReturnValue(new Promise(() => {}))
    render(<App launch={{ org: 'demo' }} />)
    await screen.findByRole('button', { name: /Account/ })
    expect(screen.queryByRole('button', { name: t.aiSetUp })).toBeNull()
    expect(screen.queryByLabelText(t.aiRequestLabel)).toBeNull()
  })

  it('gives the open object as a hint, shows the proposal, and records the request when the proposal runs', async () => {
    replies('SELECT Id, Name FROM Account LIMIT 5', '5件です。')
    await ask('5件だけ')
    const shown = await card()
    expect(within(shown).getByText('5件です。')).toBeTruthy()
    expect(mocked.aiGenerate.mock.calls[0][0]).toMatchObject({ task: 'chooseObjects', input: { openObject: 'Account' } })
    const req = mocked.aiGenerate.mock.calls[1][0]
    expect(req.task).toBe('generateSoql')
    expect(req.input).toMatchObject({ request: '5件だけ', editorText: 'SELECT Id FROM Account' })
    expect((req.input as { objectInfo: string }).objectInfo).toContain('Object Account (Account)')
    await userEvent.click(within(shown).getByRole('button', { name: t.aiReplaceRun }))
    await waitFor(() => expect(mocked.query).toHaveBeenCalled())
    expect(lastQuery()).toMatchObject({ soql: 'SELECT Id, Name FROM Account LIMIT 5', prompt: '5件だけ' })
    expect(screen.queryByRole('region', { name: t.aiProposal })).toBeNull()
  })

  it('keeps the editor text unsent once unticked, even after the query changes', async () => {
    replies('SELECT Name FROM Account')
    render(<App launch={{ org: 'demo', query: 'SELECT Id FROM Account' }} />)
    await userEvent.click(await screen.findByRole('button', { name: t.aiEditorChip }))
    await userEvent.click(within(await screen.findByRole('region', { name: 'Account' })).getByLabelText(/Industry/))
    await waitFor(() => expect(editorText()).toContain('Industry'))
    expect(screen.getByRole('button', { name: t.aiEditorChip }).getAttribute('aria-pressed')).toBe('false')
    await userEvent.type(screen.getByLabelText(t.aiRequestLabel), '名前{Enter}')
    await card()
    expect(mocked.aiGenerate.mock.calls[1][0].input).toMatchObject({ editorText: '' })
  })

  it('lets the AI choose the objects when none is open', async () => {
    mocked.aiGenerate.mockResolvedValueOnce({ output: { objects: ['Account'] } }).mockResolvedValueOnce(answer('SELECT Name FROM Account'))
    render(<App launch={{ org: 'demo' }} />)
    await screen.findByRole('button', { name: /Account/ })
    await userEvent.type(screen.getByLabelText(t.aiRequestLabel), '取引先の名前{Enter}')
    await card()
    expect(mocked.aiGenerate.mock.calls.map((c) => c[0].task)).toEqual(['chooseObjects', 'generateSoql'])
    expect((mocked.aiGenerate.mock.calls[0][0].input as { objects: string }).objects).toBe('Account (Account)')
    expect(mocked.aiGenerate.mock.calls[0][0].input).not.toHaveProperty('openObject')
  })

  it('writes the query for another object than the open one when the AI chooses it', async () => {
    mocked.sobjects.mockResolvedValue({
      sobjects: [
        { name: 'Account', label: 'Account', queryable: true },
        { name: 'Opportunity', label: 'Opportunity', queryable: true },
      ],
      fetchedAt: now,
    })
    replies('SELECT Name FROM Opportunity', 'x', ['Opportunity'])
    await ask('成約した商談')
    await card()
    expect(mocked.describe.mock.calls.map((c) => c[1])).toContain('Opportunity')
  })

  it('shows when the AI could not choose an object', async () => {
    mocked.aiGenerate.mockResolvedValueOnce({ output: { objects: ['Nothing'] } })
    render(<App launch={{ org: 'demo' }} />)
    await screen.findByRole('button', { name: /Account/ })
    await userEvent.type(screen.getByLabelText(t.aiRequestLabel), 'x{Enter}')
    expect(await screen.findByText(t.aiNoObjects)).toBeTruthy()
  })

  it('sends the request once when Enter is pressed again while generating', async () => {
    const pending = deferred<{ output: { objects: string[] } }>()
    mocked.aiGenerate.mockImplementation((async (req: { task: string }) =>
      req.task === 'chooseObjects' ? pending.promise : answer('SELECT Name FROM Account')) as never)
    await ask('5件だけ')
    await userEvent.type(screen.getByLabelText(t.aiRequestLabel), '{Enter}{Enter}')
    expect(mocked.aiGenerate).toHaveBeenCalledTimes(1)
    pending.resolve({ output: { objects: ['Account'] } })
    expect(await card()).toBeTruthy()
  })

  it('drops a request stopped by Cancel, even when its answer arrives later', async () => {
    const pending = deferred<{ output: { objects: string[] } }>()
    mocked.aiGenerate.mockImplementation((async (req: { task: string }) =>
      req.task === 'chooseObjects' ? pending.promise : answer('SELECT Name FROM Account')) as never)
    await ask('5件だけ')
    expect(await screen.findByText(t.aiStep.chooseObjects)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: t.cancel }))
    expect(screen.queryByText(t.aiStep.chooseObjects)).toBeNull()
    pending.resolve({ output: { objects: ['Account'] } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('region', { name: t.aiProposal })).toBeNull()
    expect(screen.getByRole('button', { name: t.aiGenerate })).toBeTruthy()
  })

  it('drops the request of the previous org after switching', async () => {
    const other: Org = { ...org, username: 'admin@other.example.com', alias: 'other' }
    mocked.orgs.mockResolvedValue({ orgs: [org, other], connectionCheck: 'done' })
    const pending = deferred<{ output: { objects: string[] } }>()
    mocked.aiGenerate.mockImplementation((async (req: { task: string }) =>
      req.task === 'chooseObjects' ? pending.promise : answer('SELECT Name FROM Account')) as never)
    await ask('5件だけ')
    await userEvent.click(screen.getByRole('button', { name: /demo/ }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /other/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: t.aiGenerate })).toBeTruthy())
    pending.resolve({ output: { objects: ['Account'] } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('region', { name: t.aiProposal })).toBeNull()
  })

  it('records the request for a run after Replace and after Format, but not after the query changes', async () => {
    replies('SELECT Id, Name FROM Account')
    await ask('名前も')
    await userEvent.click(within(await card()).getByRole('button', { name: t.aiReplace }))
    await waitFor(() => expect(editorText()).toContain('SELECT Id, Name FROM Account'))
    await userEvent.click(screen.getByRole('button', { name: t.format }))
    await userEvent.click(screen.getByRole('button', { name: /^(Run|実行)/ }))
    await waitFor(() => expect(mocked.query).toHaveBeenCalledTimes(1))
    expect(lastQuery()).toMatchObject({ prompt: '名前も' })
    await screen.findByText('Acme')
    await userEvent.click(within(screen.getByRole('region', { name: 'Account' })).getByLabelText(/Industry/))
    await waitFor(() => expect(editorText()).toContain('Industry'))
    await userEvent.click(screen.getByRole('button', { name: /^(Run|実行)/ }))
    await waitFor(() => expect(mocked.query).toHaveBeenCalledTimes(2))
    expect(lastQuery()).not.toHaveProperty('prompt')
  })

  it('fixes a query that Salesforce rejected, as it was run', async () => {
    mocked.query.mockRejectedValue(rejected("No such column 'Nmae'"))
    replies('SELECT Name FROM Account', 'Nmae を Name に直しました。')
    render(<App launch={{ org: 'demo', query: 'SELECT Nmae FROM Account', run: true }} />)
    await userEvent.click(await screen.findByRole('button', { name: t.aiFix }))
    await card()
    expect(mocked.aiGenerate.mock.calls[0][0]).toMatchObject({
      task: 'fixSoql',
      input: { soql: 'SELECT Nmae FROM Account', error: "No such column 'Nmae'", tooling: false },
    })
  })

  it('keeps the request of a recent query through a failed run and Fix', async () => {
    const entry: HistoryEntry = { soql: 'SELECT Nmae FROM Account', tooling: false, queryAll: false, executedAt: now, prompt: '名前の一覧' }
    mocked.history.mockResolvedValue({ entries: [entry] })
    mocked.query.mockRejectedValueOnce(rejected("No such column 'Nmae'"))
    replies('SELECT Name FROM Account')
    render(<App launch={{ org: 'demo' }} />)
    await userEvent.click(await screen.findByRole('button', { name: /SELECT Nmae FROM Account/ }))
    await userEvent.click(screen.getByRole('button', { name: /^(Run|実行)/ }))
    await userEvent.click(await screen.findByRole('button', { name: t.aiFix }))
    await userEvent.click(within(await card()).getByRole('button', { name: t.aiReplaceRun }))
    await waitFor(() => expect(mocked.query).toHaveBeenCalledTimes(2))
    expect(lastQuery()).toMatchObject({ soql: 'SELECT Name FROM Account', prompt: '名前の一覧' })
  })

  it('records nothing for a fix of a query written by hand', async () => {
    mocked.query.mockRejectedValueOnce(rejected("No such column 'Nmae'"))
    replies('SELECT Name FROM Account')
    render(<App launch={{ org: 'demo', query: 'SELECT Nmae FROM Account', run: true }} />)
    await userEvent.click(await screen.findByRole('button', { name: t.aiFix }))
    await userEvent.click(within(await card()).getByRole('button', { name: t.aiReplaceRun }))
    await waitFor(() => expect(mocked.query).toHaveBeenCalledTimes(2))
    expect(lastQuery()).not.toHaveProperty('prompt')
  })

  it('runs the proposal in place of a query that is running', async () => {
    const first = deferred<never>()
    mocked.query.mockReturnValueOnce(first.promise)
    replies('SELECT Id, Name FROM Account')
    render(<App launch={{ org: 'demo', query: 'SELECT Id FROM Account', run: true }} />)
    await waitFor(() => expect(mocked.query).toHaveBeenCalledTimes(1))
    await userEvent.type(await screen.findByLabelText(t.aiRequestLabel), '名前も{Enter}')
    await userEvent.click(within(await card()).getByRole('button', { name: t.aiReplaceRun }))
    await waitFor(() => expect(mocked.query).toHaveBeenCalledTimes(2))
    expect(lastQuery()).toMatchObject({ soql: 'SELECT Id, Name FROM Account', prompt: '名前も' })
    expect(await screen.findByText('Acme')).toBeTruthy()
  })

  it('opens the editor area to show the proposal of Fix with AI', async () => {
    mocked.query.mockRejectedValue(rejected("No such column 'Nmae'"))
    replies('SELECT Name FROM Account')
    render(<App launch={{ org: 'demo', query: 'SELECT Nmae FROM Account', run: true }} />)
    const fix = await screen.findByRole('button', { name: t.aiFix })
    await userEvent.click(screen.getByRole('button', { name: t.hideEditor }))
    await userEvent.click(fix)
    expect((await card()).closest('[hidden]')).toBeNull()
  })

  it('shows the API error under the input and drops the proposal', async () => {
    let writes = 0
    mocked.aiGenerate.mockImplementation((async (req: { task: string }) => {
      if (req.task === 'chooseObjects') return { output: { objects: ['Account'] } }
      if (writes++ === 0) return answer('SELECT Name FROM Account')
      throw new ApiRequestError(502, 'AI_ERROR', 'invalid x-api-key')
    }) as never)
    await ask('名前')
    await card()
    await userEvent.click(screen.getByRole('button', { name: t.aiGenerate }))
    expect((await screen.findByRole('alert')).textContent).toContain('invalid x-api-key')
    expect(screen.queryByRole('region', { name: t.aiProposal })).toBeNull()
    expect((screen.getByLabelText(t.aiRequestLabel) as HTMLInputElement).value).toBe('名前')
  })
})
