// docs/ai-agent.md "サーバー": the AI reading metadata through tools and answering through submit.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentTaskRequest } from '../../shared/api.ts'
import { MAX_TOOL_CALLS, runAgent, todayIn } from './agent.ts'
import { agentPrompt, invalidAgentRequest, tooLongInput } from './agentTasks.ts'
import { cutToBudget, describeText, findObjectsText, MAX_READ_BYTES, newReadState, runTool, type MetadataSource } from './tools.ts'
import type { AiError } from './errors.ts'

const anthropic = { provider: 'anthropic' as const, model: 'claude-x', apiKey: 'sk-ant', keyProvider: 'anthropic' as const }
const openai = { provider: 'openai' as const, model: 'gpt-x', apiKey: 'sk-oa', keyProvider: 'openai' as const }
const never = new AbortController().signal
const request: AgentTaskRequest & { task: 'generateRest' } = {
  task: 'generateRest',
  input: { request: 'Lプロジェクトを5件', language: 'ja', timeZone: 'Asia/Tokyo' },
}
const soqlRequest: AgentTaskRequest & { task: 'generateSoql' } = {
  task: 'generateSoql',
  input: { request: 'Unpaid invoices', language: 'en', timeZone: 'Asia/Tokyo', tooling: false },
}
const answer = { method: 'GET', path: '/services/data/v66.0/query?q=SELECT+Name+FROM+Project__c+LIMIT+5', body: '', explanation: '5件を取得します。' }

const source: MetadataSource = {
  objects: async () => [
    { name: 'Account', label: '取引先' },
    { name: 'Project__c', label: 'Lプロジェクト' },
  ],
  describe: async (name) =>
    name === 'Project__c'
      ? { name: 'Project__c', label: 'Lプロジェクト', fields: [{ name: 'Name', label: 'プロジェクト名', type: 'string', updateable: true }] }
      : undefined,
}

/** Anthropic replies, one per call, in order. */
function anthropicReplies(...contents: unknown[][]) {
  const fetch = vi.fn()
  for (const content of contents) fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ content, stop_reason: 'tool_use' }), { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
const use = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input })
const sentBody = (fetch: ReturnType<typeof vi.fn>, call: number) => JSON.parse((fetch.mock.calls[call] as unknown as [string, RequestInit])[1].body as string)

afterEach(() => vi.unstubAllGlobals())

/** One tool call, as the first of a request. */
const tool = (src: MetadataSource, name: string, input: unknown, budget = Infinity) => runTool(src, name, input, budget, newReadState())

describe('runAgent', () => {
  it('runs the tools the AI calls and returns the answer it submits', async () => {
    const fetch = anthropicReplies([use('t1', 'findObjects', { keywords: ['プロジェクト'] })], [use('t2', 'submit', answer)])
    const run = await runAgent(anthropic, request, source, '66.0', never)
    expect(run).toEqual({ output: answer, aiCalls: 2, toolCalls: 1 })
    const first = sentBody(fetch, 0)
    expect(first.tool_choice).toEqual({ type: 'auto' })
    expect(first.tools.map((t: { name: string }) => t.name)).toEqual(['findObjects', 'describeObject', 'findFields', 'submit'])
    expect(first.system).toContain('/services/data/v66.0/')
    // The tool's result goes back with the id of its call.
    const second = sentBody(fetch, 1)
    expect(second.messages.at(-1).content).toEqual([{ type: 'tool_result', tool_use_id: 't1', content: 'Project__c Lプロジェクト' }])
  })

  it('nudges once when the AI answers in text, and gives up the second time', async () => {
    anthropicReplies([{ type: 'text', text: 'GET /limits' }], [use('t1', 'submit', answer)])
    await expect(runAgent(anthropic, request, source, '66.0', never)).resolves.toMatchObject({ output: answer, aiCalls: 2 })
    anthropicReplies([{ type: 'text', text: 'a' }], [{ type: 'text', text: 'b' }])
    await expect(runAgent(anthropic, request, source, '66.0', never)).rejects.toMatchObject({ code: 'AI_BAD_OUTPUT' })
  })

  it(`stops the tools after ${MAX_TOOL_CALLS} calls and asks for the answer`, async () => {
    const reads = Array.from({ length: MAX_TOOL_CALLS }, (_, i) => [use(`t${i}`, 'describeObject', { name: 'Project__c' })])
    const fetch = anthropicReplies(...reads, [use('x', 'describeObject', { name: 'Project__c' })], [use('s', 'submit', answer)])
    await expect(runAgent(anthropic, request, source, '66.0', never)).resolves.toMatchObject({ output: answer, toolCalls: MAX_TOOL_CALLS })
    expect(sentBody(fetch, MAX_TOOL_CALLS + 1).messages.at(-1).content[0].content).toContain(`limit of ${MAX_TOOL_CALLS} tool calls`)
    // Once more past the limit, it ends.
    anthropicReplies(...reads, [use('x', 'describeObject', { name: 'A' })], [use('y', 'describeObject', { name: 'A' })])
    await expect(runAgent(anthropic, request, source, '66.0', never)).rejects.toMatchObject({ code: 'AI_BAD_OUTPUT' })
  })

  it('refuses an answer of the wrong shape: a path outside /services/, an unknown method', async () => {
    anthropicReplies([use('s', 'submit', { ...answer, path: 'https://evil.example.com/x' })])
    await expect(runAgent(anthropic, request, source, '66.0', never)).rejects.toMatchObject({ code: 'AI_BAD_OUTPUT' })
    anthropicReplies([use('s', 'submit', { ...answer, method: 'TRACE' })])
    await expect(runAgent(anthropic, request, source, '66.0', never)).rejects.toMatchObject({ code: 'AI_BAD_OUTPUT' })
  })

  it('talks to OpenAI on the Responses API, keeping nothing there and sending its reasoning back', async () => {
    const fetch = vi.fn()
    const reasoning = { type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque' }
    const call = (id: string, name: string, args: unknown) => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) })
    fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ status: 'completed', output: [reasoning, call('c1', 'describeObject', { name: 'Project__c' })] })))
    fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ status: 'completed', output: [call('c2', 'submit', answer)] })))
    vi.stubGlobal('fetch', fetch)
    await expect(runAgent(openai, request, source, '66.0', never)).resolves.toMatchObject({ output: answer, toolCalls: 1 })
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe('https://api.openai.com/v1/responses')
    const first = sentBody(fetch, 0)
    expect(first).toMatchObject({ tool_choice: 'auto', store: false, include: ['reasoning.encrypted_content'] })
    expect(first.instructions).toContain('/services/data/v66.0/')
    expect(first.tools.at(-1)).toMatchObject({ type: 'function', name: 'submit', strict: true })
    const second = sentBody(fetch, 1).input
    // The reasoning and the call go back as they came, then the tool's output.
    expect(second.slice(1, 3)).toEqual([reasoning, call('c1', 'describeObject', { name: 'Project__c' })])
    expect(second[3]).toMatchObject({ type: 'function_call_output', call_id: 'c1' })
    expect(second[3].output).toContain('Object Project__c')
  })

  it('reads an OpenAI refusal and a cut-off output', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No.' }] }] }))))
    await expect(runAgent(openai, request, source, '66.0', never)).rejects.toMatchObject({ code: 'AI_ERROR' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }))))
    await expect(runAgent(openai, request, source, '66.0', never)).rejects.toMatchObject({ code: 'AI_BAD_OUTPUT' })
  })

  it('does not send back an empty turn, which the API refuses, and nudges', async () => {
    const fetch = anthropicReplies([], [use('s', 'submit', answer)])
    await expect(runAgent(anthropic, request, source, '66.0', never)).resolves.toMatchObject({ output: answer })
    const messages = sentBody(fetch, 1).messages
    expect(messages.every((m: { content: unknown }) => !(Array.isArray(m.content) && m.content.length === 0))).toBe(true)
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'Give your answer by calling the submit tool.' })
  })

  it('still tells the AI about the limit after it was nudged once to submit', async () => {
    const reads = Array.from({ length: MAX_TOOL_CALLS }, (_, i) => [use(`t${i}`, 'describeObject', { name: 'Project__c' })])
    anthropicReplies([{ type: 'text', text: 'thinking' }], ...reads, [use('x', 'describeObject', { name: 'A' })], [use('s', 'submit', answer)])
    await expect(runAgent(anthropic, request, source, '66.0', never)).resolves.toMatchObject({ output: answer })
  })

  it('reads nothing more once the screen has gone', async () => {
    const gone = new AbortController()
    const reading = vi.fn(async () => {
      gone.abort()
      return undefined
    })
    anthropicReplies([use('a', 'describeObject', { name: 'Account' }), use('b', 'describeObject', { name: 'Project__c' })])
    await expect(runAgent(anthropic, request, { ...source, describe: reading }, '66.0', gone.signal)).rejects.toBeDefined()
    expect(reading).toHaveBeenCalledTimes(1)
  })

  it('needs the AI set up', async () => {
    await expect(runAgent({ ...anthropic, apiKey: '' }, request, source, '66.0', never)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' })
  })
})

describe('tools', () => {
  it('finds objects by name or label, ignoring case', () => {
    const objects = [
      { name: 'Account', label: '取引先' },
      { name: 'Project__c', label: 'Lプロジェクト' },
    ]
    expect(findObjectsText(objects, ['project'])).toBe('Project__c Lプロジェクト')
    expect(findObjectsText(objects, ['取引先'])).toBe('Account 取引先')
    expect(findObjectsText(objects, ['nothing'])).toBe('No object matches.')
  })

  it('lists fields one per line, marking read-only ones and active picklist values', () => {
    const text = describeText({
      name: 'Opportunity',
      label: '商談',
      fields: [
        { name: 'StageName', label: 'フェーズ', type: 'picklist', updateable: true, picklistValues: [{ value: 'Prospecting', active: true }, { value: 'Old', active: false }] },
        { name: 'AccountId', label: '取引先 ID', type: 'reference', referenceTo: ['Account'], relationshipName: 'Account', updateable: true },
        { name: 'CreatedDate', label: '作成日', type: 'datetime', updateable: false, createable: false },
      ],
      childRelationships: [{ childSObject: 'OpportunityLineItem', relationshipName: 'OpportunityLineItems' }],
    })
    expect(text.split('\n')).toEqual([
      'Object Opportunity (商談)',
      'Child relationships:',
      'OpportunityLineItems -> OpportunityLineItem',
      'Fields:',
      'StageName picklist フェーズ [Prospecting]',
      'AccountId reference(Account) relationship Account 取引先 ID',
      'CreatedDate datetime readonly 作成日',
    ])
  })

  it('takes only a describe for an object, never another cached answer such as the object list', async () => {
    const odd = { ...source, describe: async () => ({ sobjects: [] }) as never }
    expect(await tool(odd, 'describeObject', { name: 'global' })).toContain('no object named global')
  })

  it('cuts a result at the budget, on a line, and says so', () => {
    const text = Array.from({ length: 100 }, (_, i) => `Field${i} string Label`).join('\n')
    const cut = cutToBudget(text, 300)
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(300)
    expect(cut).toMatch(/^Field0 string Label\n/)
    expect(cut).toContain('(Cut here')
    expect(cutToBudget('short', 300)).toBe('short')
  })

  it('answers a call of the wrong shape with what is wrong, so that the AI can try again', async () => {
    expect(await tool(source, 'describeObject', { name: 'Account; DROP' })).toBe('name must be an object API name.')
    expect(await tool(source, 'describeObject', { name: 'Nope__c' })).toContain('no object named Nope__c')
    expect(await tool(source, 'findObjects', { keywords: 'x' })).toBe('keywords must be a list of strings.')
    expect(await tool(source, 'deleteEverything', {})).toBe('There is no tool named deleteEverything.')
  })
})

describe('agent requests', () => {
  it('needs the input of the task, a language and a real time zone', () => {
    expect(invalidAgentRequest(request as unknown as Record<string, unknown>)).toBeUndefined()
    expect(invalidAgentRequest({ ...request, input: { ...request.input, timeZone: 'Mars/Base' } })).toContain('timeZone')
    expect(invalidAgentRequest({ ...request, task: 'deploy' })).toContain('task')
    expect(invalidAgentRequest({ task: 'fixApex', input: { language: 'ja', timeZone: 'Asia/Tokyo', code: 'x' } })).toContain('problem')
  })

  it('takes the previous result only in its shape, and puts it to the AI as data', () => {
    const withPrevious = { ...request, input: { ...request.input, previous: { status: 200, body: '{"id":"001x"}' } } }
    expect(invalidAgentRequest(withPrevious as unknown as Record<string, unknown>)).toBeUndefined()
    expect(invalidAgentRequest({ ...request, input: { ...request.input, previous: { status: '200', body: '' } } })).toContain('previous')
    const prompt = agentPrompt(withPrevious as AgentTaskRequest, '66.0', '2026-10-18')
    expect(prompt.user).toContain('<data name="previous">\nHTTP 200\n\n{"id":"001x"}\n</data>')
    expect(prompt.system).toContain('<data name="previous">')
  })

  it('takes today in the user time zone', () => {
    expect(todayIn('Asia/Tokyo', new Date('2026-10-18T16:00:00Z'))).toBe('2026-10-19')
    expect(todayIn('America/Los_Angeles', new Date('2026-10-18T16:00:00Z'))).toBe('2026-10-18')
  })
})

describe('provider failures', () => {
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))

  it('shows the API error message without the key, and cuts an HTML error page short', async () => {
    vi.stubGlobal('fetch', reply(401, { error: { message: 'Incorrect API key provided: sk-proj-****abcd. You can find your API key at …' } }))
    await expect(runAgent(openai, request, source, '66.0', never)).rejects.toMatchObject({ message: expect.not.stringContaining('abcd') })
    vi.stubGlobal('fetch', reply(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }))
    await expect(runAgent(anthropic, request, source, '66.0', never)).rejects.toMatchObject({ code: 'AI_ERROR', message: 'authentication_error: invalid x-api-key' })
    vi.stubGlobal('fetch', reply(502, `<html>${'x'.repeat(5000)}</html>`))
    const error = (await runAgent(openai, request, source, '66.0', never).catch((e: unknown) => e)) as AiError
    expect(error.message.length).toBeLessThan(2100)
  })

  it('reads an Anthropic refusal and a cut-off output', async () => {
    vi.stubGlobal('fetch', reply(200, { content: [{ type: 'text', text: 'No.' }], stop_reason: 'refusal' }))
    await expect(runAgent(anthropic, request, source, '66.0', never)).rejects.toMatchObject({ code: 'AI_ERROR' })
    vi.stubGlobal('fetch', reply(200, { content: [{ type: 'text', text: '{"so' }], stop_reason: 'max_tokens' }))
    await expect(runAgent(anthropic, request, source, '66.0', never)).rejects.toMatchObject({ code: 'AI_BAD_OUTPUT' })
  })

  it('needs a provider, a model and a key for that provider, and sends nothing otherwise', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(runAgent(undefined, request, source, '66.0', never)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' })
    await expect(runAgent({ ...anthropic, provider: 'off' }, request, source, '66.0', never)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' })
    await expect(runAgent({ ...anthropic, model: ' ' }, request, source, '66.0', never)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' })
    // A key entered for Anthropic never goes to OpenAI, even if the file says so.
    await expect(runAgent({ ...anthropic, provider: 'openai' }, request, source, '66.0', never)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('gives up after the timeout and stops when the caller goes away', async () => {
    const hang = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // As fetch does: a signal aborted before the call rejects at once.
          if (init.signal?.aborted) reject(init.signal.reason)
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    vi.stubGlobal('fetch', hang)
    await expect(runAgent(anthropic, request, source, '66.0', never, 20)).rejects.toMatchObject({ code: 'AI_TIMEOUT' })
    const caller = new AbortController()
    const pending = runAgent(anthropic, request, source, '66.0', caller.signal)
    caller.abort()
    await expect(pending).rejects.not.toHaveProperty('code', 'AI_TIMEOUT')
  })
})

describe('SOQL', () => {
  const ns = 'acme'
  const orgObjects = [
    { name: 'Invoice', label: 'Invoice', queryable: true },
    { name: 'acme__Invoice__c', label: 'Invoice', custom: true, queryable: true },
    { name: 'AccountShare', label: 'Account Share', queryable: true },
    { name: 'Hidden__c', label: 'Hidden invoice', custom: true, queryable: false },
  ]
  const describeInvoice = vi.fn(async (name: string) =>
    name === 'acme__Invoice__c'
      ? {
          name,
          label: 'Invoice',
          fields: [
            { name: 'acme__Status__c', label: 'Status', type: 'picklist', updateable: true, picklistValues: [{ value: 'Unpaid', active: true }] },
            { name: 'acme__Account__c', label: 'Account', type: 'reference', referenceTo: ['Account'], relationshipName: 'acme__Account__r', updateable: true },
          ],
          childRelationships: [{ childSObject: 'acme__Line__c', relationshipName: 'acme__Lines__r' }],
        }
      : undefined,
  )
  const soqlSource: MetadataSource = { objects: async () => orgObjects, describe: describeInvoice, soql: true, omitNamespace: ns }

  it('searches queryable objects only, the noise last, marking custom ones and leaving out the namespace', () => {
    expect(findObjectsText(orgObjects, ['share', 'invoice'], soqlSource).split('\n')).toEqual(['Invoice Invoice', 'Invoice__c Invoice (custom)', 'AccountShare Account Share'])
    // REST API and Apex see every object, with full names.
    expect(findObjectsText(orgObjects, ['invoice'])).toContain('acme__Invoice__c Invoice (custom)')
  })

  it('reads an object named with or without the namespace, in any case, under the spelling of the list', async () => {
    describeInvoice.mockClear()
    const text = await tool(soqlSource, 'describeObject', { name: 'INVOICE__C' })
    expect(describeInvoice).toHaveBeenCalledWith('acme__Invoice__c')
    expect(text.split('\n')).toEqual([
      'Object Invoice__c (Invoice)',
      'Child relationships:',
      'Lines__r -> Line__c',
      'Fields:',
      'Status__c picklist Status [Unpaid]',
      'Account__c reference(Account) relationship Account__r Account',
    ])
    // Without the omitted namespace, only the full name is the object.
    const full = { ...soqlSource, omitNamespace: undefined }
    expect(await tool(full, 'describeObject', { name: 'Invoice__c' })).toContain('no object named Invoice__c')
    expect(await tool(full, 'describeObject', { name: 'acme__Invoice__c' })).toContain('Object acme__Invoice__c')
  })

  it('writes a query with the open object as a hint, the editor as data, and the SOQL rules', async () => {
    const fetch = anthropicReplies([use('t1', 'submit', { soql: "SELECT Id FROM Invoice__c WHERE Status__c = 'Unpaid'", explanation: 'ok' })])
    const req = { ...soqlRequest, input: { ...soqlRequest.input, openObject: 'acme__invoice__c', editor: 'SELECT Id FROM Account', tooling: true } }
    const run = await runAgent(anthropic, req, soqlSource, '66.0', never)
    expect(run.output).toEqual({ soql: "SELECT Id FROM Invoice__c WHERE Status__c = 'Unpaid'", explanation: 'ok' })
    const first = sentBody(fetch, 0)
    expect(first.system).toContain('The user has the object Invoice__c open on screen. It is a hint only')
    expect(first.system).toContain('Tooling API')
    expect(first.system).toContain('read every object you query')
    expect(first.system).toContain('a reference field without one cannot be followed')
    expect(first.messages[0].content).toContain('<data name="editor">\nSELECT Id FROM Account\n</data>')
  })

  it('leaves out an open object the org (or the Tooling API) does not have', async () => {
    const fetch = anthropicReplies([use('t1', 'submit', { soql: 'SELECT Id FROM Invoice', explanation: 'ok' })])
    await runAgent(anthropic, { ...soqlRequest, input: { ...soqlRequest.input, openObject: 'Nope__c' } }, soqlSource, '66.0', never)
    expect(sentBody(fetch, 0).system).not.toContain('open on screen')
  })

  it('fixes a query with the fields of its FROM object given from the start', async () => {
    const fetch = anthropicReplies([use('t1', 'submit', { soql: 'SELECT Status__c FROM Invoice__c', explanation: 'fixed' })])
    const req: AgentTaskRequest = {
      task: 'fixSoql',
      input: { soql: 'SELECT Stat FROM Invoice__c', error: "No such column 'Stat'", object: 'Invoice__c', tooling: false, language: 'en', timeZone: 'UTC' },
    }
    await expect(runAgent(anthropic, req, soqlSource, '66.0', never)).resolves.toMatchObject({ output: { soql: 'SELECT Status__c FROM Invoice__c' }, toolCalls: 0 })
    const user = sentBody(fetch, 0).messages[0].content as string
    expect(user).toContain('<data name="metadata">\nObject Invoice__c (Invoice)')
    expect(user).toContain('<data name="error">\nNo such column')
  })

  it('takes only a SELECT query as the answer', async () => {
    anthropicReplies([use('t1', 'submit', { soql: 'FIND {Acme} RETURNING Account', explanation: 'x' })])
    await expect(runAgent(anthropic, soqlRequest, soqlSource, '66.0', never)).rejects.toMatchObject({ code: 'AI_BAD_OUTPUT' })
  })

  it('does not send an object read before again', async () => {
    const fetch = anthropicReplies(
      [use('t1', 'describeObject', { name: 'Invoice__c' })],
      [use('t2', 'describeObject', { name: 'acme__invoice__c' })],
      [use('t3', 'submit', { soql: 'SELECT Id FROM Invoice__c', explanation: 'x' })],
    )
    await runAgent(anthropic, soqlRequest, soqlSource, '66.0', never)
    const results = sentBody(fetch, 2).messages.filter((m: { role: string }) => m.role === 'user').slice(1).map((m: { content: { content: string }[] }) => m.content[0].content)
    expect(results[0]).toContain('Object Invoice__c')
    expect(results[1]).toBe('Invoice__c is already above in this conversation: use it, and findFields for what was left out.')
  })

  describe('a large object', () => {
    const bytes = (text: string) => new TextEncoder().encode(text).length
    const picklist = (n: number) => Array.from({ length: n }, (_, j) => ({ value: `Value ${j}`, active: true }))
    const field = (i: number, extra: Partial<FieldJsonLike> = {}) => ({ name: `Field_${i}__c`, label: `A rather long label for the field number ${i}`, type: 'picklist', picklistValues: picklist(6), ...extra })
    type FieldJsonLike = { name: string; label: string; type: string; picklistValues: { value: string; active: boolean }[] }
    const children = (n: number) => Array.from({ length: n }, (_, i) => ({ childSObject: `Child${i}__c`, relationshipName: `Children${i}__r` }))
    // About 90 KB in full, 25 KB with types only.
    const big = { name: 'Big__c', label: 'Big', fields: Array.from({ length: 400 }, (_, i) => field(i)), childRelationships: children(30) }
    // Over 40 KB even with types only: names only.
    const huge = { name: 'Huge__c', label: 'Huge', fields: Array.from({ length: 1200 }, (_, i) => field(i, { type: 'reference', referenceTo: ['Account'], relationshipName: `Rel_${i}__r` } as never)), childRelationships: children(300) }
    const small = { name: 'Small__c', label: 'Small', fields: [{ name: 'Name', label: 'Name', type: 'string' }, { name: 'Region__c', label: 'Region', type: 'picklist', picklistValues: picklist(120) }] }
    const objects = ['Big__c', 'Huge__c', 'Small__c', 'Gone__c'].map((name) => ({ name, label: name }))
    const describes: Record<string, unknown> = { Big__c: big, Huge__c: huge, Small__c: small }
    const bigSource: MetadataSource = { objects: async () => objects, describe: async (n) => describes[n] as never, soql: true }

    it('names every child relationship and field within one result: types only, then names only', async () => {
      const typed = await tool(bigSource, 'describeObject', { name: 'Big__c' })
      expect(bytes(typed)).toBeLessThanOrEqual(MAX_READ_BYTES)
      expect(typed).toContain('Labels and picklist values are left out')
      expect(typed).toContain('Children29__r -> Child29__c')
      expect(typed).toContain('Field_399__c picklist')
      expect(typed).not.toContain('Value 0')
      const named = await tool(bigSource, 'describeObject', { name: 'Huge__c' })
      expect(bytes(named)).toBeLessThanOrEqual(MAX_READ_BYTES)
      expect(named).toContain('Types, labels and picklist values are left out')
      expect(named).toContain('Children299__r')
      expect(named).toContain('Field_1199__c')
    })

    it('lists the names of an object too large for one result within the budget left, or sends to findFields', async () => {
      // Names alone of about 130 KB: more than one result.
      const fields = Array.from({ length: 3000 }, (_, i) => ({ name: `A_Very_Long_Field_Name_For_Testing_${i}__c`, label: 'L', type: 'string' }))
      const giant: MetadataSource = { objects: async () => [{ name: 'Giant__c', label: 'Giant' }], describe: async () => ({ name: 'Giant__c', label: 'Giant', fields }) }
      const names = await tool(giant, 'describeObject', { name: 'Giant__c' }, 200_000)
      expect(bytes(names)).toBeGreaterThan(MAX_READ_BYTES)
      expect(names).toContain('A_Very_Long_Field_Name_For_Testing_2999__c')
      // Not even the names fit, with much of the budget left: findFields, and taken as returned.
      const state = newReadState()
      expect(await runTool(giant, 'describeObject', { name: 'Giant__c' }, 60_000, state)).toBe(
        'Object Giant__c (Giant) has 3000 fields and 0 child relationships, too many to list: use findFields to find the ones you need.',
      )
      expect([...state.listed]).toEqual(['Giant__c'])
      expect(await tool(giant, 'describeObject', { name: 'Giant__c' }, 30_000)).toContain('Not returned')
    })

    it('finds a reference by its relationship name', async () => {
      expect(await tool(bigSource, 'findFields', { object: 'Huge__c', keywords: ['rel_7__r'] })).toContain('Field_7__c reference(Account) relationship Rel_7__r')
    })

    it('finds fields and child relationships in full, exact names first, and says how many more there are', async () => {
      const text = await tool(bigSource, 'findFields', { object: 'big__c', keywords: ['field_7__c', 'children2'] })
      const lines = text.split('\n')
      expect(lines[0]).toBe('Object Big__c:')
      expect(lines[1]).toBe('Field_7__c picklist A rather long label for the field number 7 [Value 0, Value 1, Value 2, Value 3, Value 4, Value 5]')
      expect(text).toContain('child relationship Children2__r -> Child2__c')
      expect(text).toContain('child relationship Children29__r -> Child29__c')
      const many = await tool(bigSource, 'findFields', { object: 'Big__c', keywords: ['field'] })
      expect(many).toContain('(350 more: use more specific keywords.)')
      expect(await tool(bigSource, 'findFields', { object: 'Big__c', keywords: ['nothing'] })).toBe('No field or child relationship of Big__c matches.')
      expect(await tool(bigSource, 'findFields', { object: 'Nope__c', keywords: ['x'] })).toContain('no object named Nope__c')
      expect(await tool(bigSource, 'findFields', { object: 'Big__c', keywords: [' '] })).toBe('Give at least one keyword.')
    })

    it('says how many picklist values are left out', async () => {
      expect(await tool(bigSource, 'findFields', { object: 'Small__c', keywords: ['region'] })).toContain('Value 49] (+70 more)')
    })

    it('keeps within the budget left, and returns nothing rather than a cut list when it is nearly used up', async () => {
      expect(await tool(bigSource, 'describeObject', { name: 'Small__c' }, 60)).toContain('Not returned: the limit of what the tools return is near')
      expect(await tool(bigSource, 'findFields', { object: 'Big__c', keywords: ['field'] }, 100)).toContain('Not returned')
      expect(bytes(await tool(bigSource, 'findFields', { object: 'Big__c', keywords: ['field'] }, 5_000))).toBeLessThanOrEqual(5_000)
    })

    it('does not list an object again, whatever form it came in, and not as read when nothing came', async () => {
      const state = newReadState()
      await runTool(bigSource, 'describeObject', { name: 'Big__c' }, Infinity, state)
      expect(await runTool(bigSource, 'describeObject', { name: 'BIG__C' }, Infinity, state)).toBe('Big__c is already above in this conversation: use it, and findFields for what was left out.')
      expect(await runTool(bigSource, 'describeObject', { name: 'Gone__c' }, Infinity, state)).toContain('no object named Gone__c')
      expect(await runTool(bigSource, 'describeObject', { name: 'Small__c' }, 60, state)).toContain('Not returned')
      expect([...state.listed]).toEqual(['Big__c'])
    })

    it('gives the FROM object of a fix as describeObject would, and tells the AI not to read it again', async () => {
      const fetch = anthropicReplies([use('t1', 'describeObject', { name: 'Big__c' })], [use('t2', 'submit', { soql: 'SELECT Id FROM Big__c', explanation: 'x' })])
      const req: AgentTaskRequest = { task: 'fixSoql', input: { soql: 'SELECT X FROM Big__c', error: 'e', object: 'big__c', tooling: false, language: 'en', timeZone: 'UTC' } }
      await runAgent(anthropic, req, bigSource, '66.0', never)
      const first = sentBody(fetch, 0)
      expect(first.system).toContain('do not read it again, and use findFields for anything it leaves out')
      expect(first.messages[0].content).toContain('Labels and picklist values are left out')
      expect(sentBody(fetch, 1).messages.at(-1).content[0].content).toContain('already above')
    })
  })

  it('refuses an editor text or a query too long to send, as the one place that judges it', () => {
    const long = 'x'.repeat(50_001)
    expect(tooLongInput({ ...soqlRequest, input: { ...soqlRequest.input, editor: long } })).toContain('editor text is too long')
    expect(tooLongInput({ task: 'fixSoql', input: { soql: long } })).toContain('query or its error is too long')
    expect(tooLongInput({ task: 'fixSoql', input: { soql: 'SELECT Id FROM Account', error: long } })).toContain('query or its error is too long')
    expect(tooLongInput({ ...soqlRequest, input: { ...soqlRequest.input, editor: 'SELECT Id FROM Account' } })).toBeUndefined()
  })

  it('checks SOQL requests', () => {
    expect(invalidAgentRequest(soqlRequest as unknown as Record<string, unknown>)).toBeUndefined()
    expect(invalidAgentRequest({ ...soqlRequest, input: { ...soqlRequest.input, tooling: 'yes' } })).toContain('tooling')
    expect(invalidAgentRequest({ task: 'fixSoql', input: { language: 'en', timeZone: 'UTC', soql: 'x', tooling: false } })).toContain('error')
  })
})
