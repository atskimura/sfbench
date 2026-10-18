// @vitest-environment jsdom
// The REST API screen's flows (docs/rest.md "状態と遷移"), through the whole app.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Org, RestHistoryEntry, RestResponse } from '../shared/api.ts'

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
      rest: vi.fn(),
      restHistory: vi.fn(),
      aiAgent: vi.fn(),
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
const prod: Org = { ...org, username: 'admin@acme.example.com', alias: 'acme-prod', edition: 'Enterprise Edition' }
const path = '/services/data/v66.0/sobjects/Account'
const answer = (status: number, body: unknown = { id: '001' }): RestResponse & { apiUsage: undefined } => ({
  id: 'r1',
  status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
  size: 10,
  elapsedMs: 120,
  apiUsage: undefined,
})

/** A promise to settle by hand. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function openRest(launch: Parameters<typeof App>[0]['launch'] = { org: 'demo' }) {
  render(<App launch={launch} />)
  await userEvent.click(await screen.findByRole('button', { name: t.modeRest }))
  return screen.findByLabelText(t.restPath)
}

async function fill(method: string, value: string) {
  await userEvent.selectOptions(screen.getByLabelText(t.restMethod), method)
  const input = screen.getByLabelText(t.restPath)
  await userEvent.clear(input)
  await userEvent.type(input, value)
}

const response = () => screen.getByRole('region', { name: t.restResponse })
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
  mocked.describe.mockResolvedValue({
    name: 'Account',
    label: 'Account',
    fields: [field('Id', 'Account ID', { type: 'id' }), field('Name', 'Account Name'), field('Industry', 'Industry')],
    childRelationships: [{ childSObject: 'Contact', field: 'AccountId', relationshipName: 'Contacts' }],
    fetchedAt: now,
  })
  mocked.history.mockResolvedValue({ entries: [] })
  mocked.restHistory.mockResolvedValue({ entries: [] })
  sessionStorage.clear()
  localStorage.clear()
  mocked.query.mockResolvedValue({ totalSize: 1, done: true, records: [{ attributes: { type: 'Account', url: '' }, Id: '001', Name: 'Acme' }] })
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('REST API screen', () => {
  it('sends a GET and shows a 4xx as the response, not as an error', async () => {
    mocked.rest.mockResolvedValue(answer(404, [{ errorCode: 'NOT_FOUND', message: 'The requested resource does not exist' }]))
    await openRest()
    await fill('GET', path + '/001')
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    expect(await within(response()).findByText('404')).toBeTruthy()
    expect(response().textContent).toContain('NOT_FOUND')
    expect(mocked.rest).toHaveBeenCalledWith('admin@demo.example.com', { method: 'GET', path: path + '/001', headers: {} }, expect.any(AbortSignal))
  })

  it('keeps a request going while the SOQL screen is shown, and shows its answer back on the REST screen', async () => {
    const pending = deferred<ReturnType<typeof answer>>()
    mocked.rest.mockReturnValue(pending.promise)
    await openRest()
    await fill('POST', path)
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    await userEvent.click(screen.getByRole('button', { name: t.modeSoql }))
    pending.resolve(answer(201))
    await userEvent.click(screen.getByRole('button', { name: t.modeRest }))
    expect(await within(response()).findByText('201')).toBeTruthy()
  })

  it('asks before a request that may change data in production, and sends it once', async () => {
    mocked.orgs.mockResolvedValue({ orgs: [prod], connectionCheck: 'done' })
    mocked.summary.mockResolvedValue({ organizationType: 'Enterprise Edition', isSandbox: false, namespacePrefix: null })
    mocked.rest.mockResolvedValue(answer(204))
    await openRest({ org: 'acme-prod' })
    await fill('DELETE', path + '/001')
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain(t.restConfirmProduction('acme-prod', `DELETE ${path}/001`))
    await userEvent.click(within(dialog).getByRole('button', { name: t.cancel }))
    expect(mocked.rest).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    await userEvent.dblClick(within(await screen.findByRole('dialog')).getByRole('button', { name: t.restConfirmSend }))
    await within(response()).findByText('204')
    expect(mocked.rest).toHaveBeenCalledTimes(1)
  })

  it('does not ask in production for a GET', async () => {
    mocked.orgs.mockResolvedValue({ orgs: [prod], connectionCheck: 'done' })
    mocked.summary.mockResolvedValue({ organizationType: 'Enterprise Edition', isSandbox: false, namespacePrefix: null })
    mocked.rest.mockResolvedValue(answer(200))
    await openRest({ org: 'acme-prod' })
    await fill('GET', path)
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    await within(response()).findByText('200')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers Cancel for a GET, but not for a request that may change data', async () => {
    mocked.rest.mockReturnValue(new Promise(() => {}))
    await openRest()
    await fill('GET', path)
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    await userEvent.click(within(response()).getByRole('button', { name: t.cancel }))
    expect(response().textContent).toContain(t.restNotSent)
    await fill('POST', path)
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    expect(within(response()).queryByRole('button', { name: t.cancel })).toBeNull()
    expect(screen.getByText(t.restWaiting(120))).toBeTruthy()
  })

  it('says the outcome is unknown after a timeout, and asks before the same request is sent again', async () => {
    mocked.rest.mockRejectedValueOnce(new ApiRequestError(504, 'SALESFORCE_TIMEOUT', 'timed out'))
    const unknown: RestHistoryEntry = { id: 'r1', method: 'POST', path, sentAt: now, outcome: { state: 'unknown', reason: 'timeout' } }
    await openRest()
    await fill('POST', path)
    mocked.restHistory.mockResolvedValue({ entries: [unknown] })
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    expect(await within(response()).findByText(t.restUnknown)).toBeTruthy()
    await within(screen.getByRole('region', { name: t.restHistory })).findByText(t.restUnknownShort)
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    expect((await screen.findByRole('dialog')).textContent).toContain(t.restConfirmUnknown)
    expect(mocked.rest).toHaveBeenCalledTimes(1)
  })

  it('asks before a request that may change data while the history cannot be loaded', async () => {
    mocked.restHistory.mockRejectedValue(new ApiRequestError(500, 'INTERNAL_ERROR', 'boom'))
    await openRest()
    await fill('POST', path)
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    expect((await screen.findByRole('dialog')).textContent).toContain(t.restConfirmNoHistory)
  })

  it('does not send on Enter in the path, even a DELETE', async () => {
    await openRest()
    await fill('DELETE', path + '/001')
    await userEvent.type(screen.getByLabelText(t.restPath), '{Enter}')
    expect(mocked.rest).not.toHaveBeenCalled()
  })

  it('asks again right after an unknown outcome, before the history is loaded again', async () => {
    mocked.rest.mockRejectedValueOnce(new ApiRequestError(502, 'SALESFORCE_UNREACHABLE', 'broke'))
    // Loaded once when the screen opens, then never again.
    mocked.restHistory.mockResolvedValueOnce({ entries: [] }).mockReturnValue(new Promise(() => {}))
    await openRest()
    await waitFor(() => expect(mocked.restHistory).toHaveBeenCalledTimes(1))
    await fill('POST', path)
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    await within(response()).findByText(t.restUnknown)
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    expect((await screen.findByRole('dialog')).textContent).toContain(t.restConfirmUnknown)
  })

  it('never sends with Cmd+Enter, even a GET, and says how to send', async () => {
    mocked.rest.mockResolvedValue(answer(200))
    await openRest()
    for (const method of ['POST', 'GET']) {
      await fill(method, path)
      await userEvent.type(screen.getByLabelText(t.restPath), '{Meta>}{Enter}{/Meta}')
      expect(screen.getByText(t.restModEnterHint)).toBeTruthy()
    }
    expect(mocked.rest).not.toHaveBeenCalled()
  })

  it('fills in a request from the command line without sending it', async () => {
    await openRest({ org: 'demo', rest: { method: 'PATCH', path: path + '/001', body: '{"Name":"B"}' } })
    expect((screen.getByLabelText(t.restPath) as HTMLInputElement).value).toBe(path + '/001')
    expect((screen.getByLabelText(t.restMethod) as HTMLSelectElement).value).toBe('PATCH')
    expect(screen.getByText(t.restLaunchNotice)).toBeTruthy()
    expect(mocked.rest).not.toHaveBeenCalled()
  })

  it('opens the REST screen at launch for a --rest request', async () => {
    render(<App launch={{ org: 'demo', rest: { method: 'GET', path } }} />)
    expect(((await screen.findByLabelText(t.restPath)) as HTMLInputElement).value).toBe(path)
  })

  it('leaves out a request from the command line for another org', async () => {
    mocked.orgs.mockResolvedValue({ orgs: [org, prod], connectionCheck: 'done' })
    render(<App launch={{ org: 'gone', rest: { method: 'DELETE', path } }} />)
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /demo/ }))
    expect(await screen.findByText(t.restLeftOut('gone'))).toBeTruthy()
    expect((screen.getByLabelText(t.restPath) as HTMLInputElement).value).toBe('')
  })

  it('drops the answer of the previous org after switching', async () => {
    mocked.orgs.mockResolvedValue({ orgs: [org, prod], connectionCheck: 'done' })
    const pending = deferred<ReturnType<typeof answer>>()
    mocked.rest.mockReturnValue(pending.promise)
    await openRest()
    await fill('GET', path)
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    await userEvent.click(screen.getByRole('button', { name: /demo/ }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /acme-prod/ }))
    pending.resolve(answer(200))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(response().textContent).toContain(t.restNotSent)
  })

  it('saves the history entry put back, not the fields before it, for a reload', async () => {
    const entry: RestHistoryEntry = { id: 'r1', method: 'POST', path, body: '{"Name":"A"}', sentAt: now, outcome: { state: 'done', status: 201, elapsedMs: 1 } }
    mocked.restHistory.mockResolvedValue({ entries: [entry] })
    await openRest()
    await fill('DELETE', path + '/001')
    await userEvent.click(await within(screen.getByRole('region', { name: t.restHistory })).findByRole('button', { name: /sobjects\/Account/ }))
    await new Promise((resolve) => setTimeout(resolve, 400))
    const saved = JSON.parse(sessionStorage.getItem('sfbench.restDraft') ?? 'null') as { draft: { method: string; path: string; body: string } }
    expect(saved.draft).toMatchObject({ method: 'POST', path, body: '{"Name":"A"}' })
  })

  it('closes the history and the request area, and sends from the closed request', async () => {
    mocked.rest.mockResolvedValue(answer(200))
    await openRest()
    await fill('GET', path)
    await userEvent.click(screen.getByRole('button', { name: t.hideRestHistory }))
    expect(screen.queryByRole('region', { name: t.restHistory })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: t.showRestHistory }))
    expect(screen.getByRole('region', { name: t.restHistory })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: t.hideRestRequest }))
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    expect(await within(response()).findByText('200')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('sfbench.restPanels') ?? '{}')).toMatchObject({ restRequest: false })
  })

  it('keeps the body while the request area is closed, and sends it from the closed line', async () => {
    mocked.rest.mockResolvedValue(answer(201))
    await openRest()
    await fill('POST', path)
    // CodeMirror cannot be typed into on jsdom: write through its view (docs/web.md "テスト").
    const view = EditorView.findFromDOM(screen.getByRole('textbox', { name: t.restBodyLabel }))!
    act(() => view.dispatch({ changes: { from: 0, insert: '{"Name":"A"}' } }))
    await userEvent.click(screen.getByRole('button', { name: t.hideRestRequest }))
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    await within(response()).findByText('201')
    expect(mocked.rest.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{"Name":"A"}' })
    await userEvent.click(screen.getByRole('button', { name: t.showRestRequest }))
    expect(screen.getByRole('textbox', { name: t.restBodyLabel }).textContent).toBe('{"Name":"A"}')
  })

  it('puts a history entry back into the fields without sending it', async () => {
    const entry: RestHistoryEntry = { id: 'r1', method: 'GET', path: path + '/describe', sentAt: now, outcome: { state: 'done', status: 200, elapsedMs: 1 } }
    mocked.restHistory.mockResolvedValue({ entries: [entry] })
    await openRest()
    await userEvent.click(await within(screen.getByRole('region', { name: t.restHistory })).findByRole('button', { name: /describe/ }))
    expect((screen.getByLabelText(t.restPath) as HTMLInputElement).value).toBe(path + '/describe')
    expect(mocked.rest).not.toHaveBeenCalled()
  })
})

// docs/ai-agent.md "画面": the REST API screen's AI.
describe('REST API AI', () => {
  const ready = { provider: 'anthropic' as const, model: 'claude-x', hasApiKey: true, keyProvider: 'anthropic' as const }
  const proposal = { method: 'POST' as const, path, body: '{"Name":"Acme"}', explanation: '取引先を作ります。' }
  const requestRegion = () => screen.getByRole('region', { name: t.restRequest })

  beforeEach(() => {
    mocked.settings.mockResolvedValue({ omitNamespace: true, requestTimeoutSeconds: 120, ai: ready })
  })

  it('asks the AI with the request now, and puts its proposal in the fields without sending', async () => {
    mocked.aiAgent.mockResolvedValue({ output: proposal })
    await openRest()
    await fill('GET', path)
    await userEvent.type(within(requestRegion()).getByRole('textbox', { name: t.aiRequestLabel }), '取引先を作る{Enter}')
    const card = await within(requestRegion()).findByRole('region', { name: t.aiProposal })
    expect(card.textContent).toContain('取引先を作ります。')
    // Only Replace: the request may change data.
    expect(within(card).queryByRole('button', { name: t.aiReplaceRun })).toBeNull()
    const sent = mocked.aiAgent.mock.calls[0]
    expect(sent[0]).toBe('admin@demo.example.com')
    expect(sent[1]).toMatchObject({ task: 'generateRest', input: { request: '取引先を作る', current: { method: 'GET', path, body: '' } } })
    await userEvent.click(within(card).getByRole('button', { name: t.aiReplace }))
    expect((screen.getByLabelText(t.restMethod) as HTMLSelectElement).value).toBe('POST')
    expect(screen.getByRole('textbox', { name: t.restBodyLabel }).textContent).toBe('{"Name":"Acme"}')
    expect(mocked.rest).not.toHaveBeenCalled()
  })

  it('does not send the request now once its pill is unticked', async () => {
    mocked.aiAgent.mockResolvedValue({ output: proposal })
    await openRest()
    await fill('GET', path)
    await userEvent.click(within(requestRegion()).getByRole('button', { name: new RegExp(t.aiSendCurrentRequest) }))
    await userEvent.type(within(requestRegion()).getByRole('textbox', { name: t.aiRequestLabel }), 'x{Enter}')
    await within(requestRegion()).findByRole('region', { name: t.aiProposal })
    expect(mocked.aiAgent.mock.calls[0][1].input).not.toHaveProperty('current')
  })

  it('fixes a request Salesforce refused, as it was sent, and offers it only for an error', async () => {
    mocked.rest.mockResolvedValueOnce(answer(400, [{ errorCode: 'REQUIRED_FIELD_MISSING', message: 'CloseDate' }]))
    mocked.aiAgent.mockResolvedValue({ output: proposal })
    await openRest()
    await fill('POST', path)
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    await within(response()).findByText('400')
    // Changed after sending: the fix is for what was sent.
    await fill('GET', path + '/x')
    await userEvent.click(within(response()).getByRole('button', { name: t.aiFix }))
    await within(requestRegion()).findByRole('region', { name: t.aiProposal })
    expect(mocked.aiAgent.mock.calls[0][1]).toMatchObject({
      task: 'fixRest',
      input: { sent: { method: 'POST', path, body: '' }, status: 400, responseBody: JSON.stringify([{ errorCode: 'REQUIRED_FIELD_MISSING', message: 'CloseDate' }]) },
    })
    mocked.rest.mockResolvedValueOnce(answer(200))
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    await within(response()).findByText('200')
    expect(within(response()).queryByRole('button', { name: t.aiFix })).toBeNull()
  })

  it('sends the last response only when its pill is pressed, as it can hold record values', async () => {
    mocked.rest.mockResolvedValue(answer(200, { records: [{ Id: '001x' }] }))
    mocked.aiAgent.mockResolvedValue({ output: proposal })
    await openRest()
    expect(within(requestRegion()).queryByRole('button', { name: new RegExp(t.aiSendPrevious) })).toBeNull()
    await fill('GET', path)
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    await within(response()).findByText('200')
    const pill = within(requestRegion()).getByRole('button', { name: new RegExp(t.aiSendPrevious) })
    expect(pill.getAttribute('aria-pressed')).toBe('false')
    const ask = async () => {
      await userEvent.type(within(requestRegion()).getByRole('textbox', { name: t.aiRequestLabel }), 'x{Enter}')
      await within(requestRegion()).findByRole('region', { name: t.aiProposal })
      await userEvent.click(within(requestRegion()).getByRole('button', { name: t.aiDiscard }))
    }
    await ask()
    expect(mocked.aiAgent.mock.calls[0][1].input).not.toHaveProperty('previous')
    await userEvent.click(pill)
    await ask()
    expect(mocked.aiAgent.mock.calls[1][1].input).toMatchObject({ previous: { status: 200, body: JSON.stringify({ records: [{ Id: '001x' }] }) } })
    // Sent once: the next request goes without it unless chosen again.
    expect(within(requestRegion()).getByRole('button', { name: new RegExp(t.aiSendPrevious) }).getAttribute('aria-pressed')).toBe('false')
    await ask()
    expect(mocked.aiAgent.mock.calls[2][1].input).not.toHaveProperty('previous')
  })

  it('does not send a newer result than the one chosen', async () => {
    mocked.rest.mockResolvedValue(answer(200))
    await openRest()
    await fill('GET', path)
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    await within(response()).findByText('200')
    await userEvent.click(within(response()).getByRole('button', { name: t.aiUseResult }))
    mocked.rest.mockResolvedValue(answer(201))
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    await within(response()).findByText('201')
    expect(within(requestRegion()).getByRole('button', { name: new RegExp(t.aiSendPrevious) }).getAttribute('aria-pressed')).toBe('false')
  })

  it('turns on the last result from the response, opening the request area and focusing the AI input', async () => {
    mocked.rest.mockResolvedValue(answer(200))
    await openRest()
    await fill('GET', path)
    await userEvent.click(screen.getByRole('button', { name: t.restSend }))
    await within(response()).findByText('200')
    await userEvent.click(screen.getByRole('button', { name: t.hideRestRequest }))
    await userEvent.click(within(response()).getByRole('button', { name: t.aiUseResult }))
    const input = within(requestRegion()).getByRole('textbox', { name: t.aiRequestLabel })
    expect(requestRegion().closest('[hidden]')).toBeNull()
    expect(document.activeElement).toBe(input)
    expect(input.getAttribute('placeholder')).toBe(t.aiPreviousPlaceholder)
    expect(within(requestRegion()).getByRole('button', { name: new RegExp(t.aiSendPrevious) }).getAttribute('aria-pressed')).toBe('true')
    // Pressed again, it stops sending it.
    await userEvent.click(within(response()).getByRole('button', { name: t.aiUsingResult }))
    expect(within(requestRegion()).getByRole('button', { name: new RegExp(t.aiSendPrevious) }).getAttribute('aria-pressed')).toBe('false')
  })
})
