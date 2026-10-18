// docs/ai-agent.md "サーバー": the AI reading metadata through tools and answering through submit.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentTaskRequest } from '../../shared/api.ts'
import { MAX_TOOL_CALLS, runAgent, todayIn } from './agent.ts'
import { invalidAgentRequest } from './agentTasks.ts'
import { describeText, findObjectsText, runTool, type MetadataSource } from './tools.ts'

const anthropic = { provider: 'anthropic' as const, model: 'claude-x', apiKey: 'sk-ant', keyProvider: 'anthropic' as const }
const openai = { provider: 'openai' as const, model: 'gpt-x', apiKey: 'sk-oa', keyProvider: 'openai' as const }
const never = new AbortController().signal
const request: AgentTaskRequest & { task: 'generateRest' } = {
  task: 'generateRest',
  input: { request: 'Lプロジェクトを5件', language: 'ja', timeZone: 'Asia/Tokyo' },
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

describe('runAgent', () => {
  it('runs the tools the AI calls and returns the answer it submits', async () => {
    const fetch = anthropicReplies([use('t1', 'findObjects', { keywords: ['プロジェクト'] })], [use('t2', 'submit', answer)])
    const run = await runAgent(anthropic, request, source, '66.0', never)
    expect(run).toEqual({ output: answer, aiCalls: 2, toolCalls: 1 })
    const first = sentBody(fetch, 0)
    expect(first.tool_choice).toEqual({ type: 'auto' })
    expect(first.tools.map((t: { name: string }) => t.name)).toEqual(['findObjects', 'describeObject', 'submit'])
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
    expect(sentBody(fetch, MAX_TOOL_CALLS + 1).messages.at(-1).content[0].content).toContain('limit of tool calls')
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

  it('talks to OpenAI with functions, reading their arguments as JSON', async () => {
    const fetch = vi.fn()
    const toolCall = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
    fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [toolCall('c1', 'describeObject', { name: 'Project__c' })] }, finish_reason: 'tool_calls' }] })))
    fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [toolCall('c2', 'submit', answer)] }, finish_reason: 'tool_calls' }] })))
    vi.stubGlobal('fetch', fetch)
    await expect(runAgent(openai, request, source, '66.0', never)).resolves.toMatchObject({ output: answer, toolCalls: 1 })
    const first = sentBody(fetch, 0)
    expect(first.tool_choice).toBe('auto')
    expect(first.tools[2]).toMatchObject({ type: 'function', function: { name: 'submit', strict: true } })
    const second = sentBody(fetch, 1)
    expect(second.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' })
    expect(second.messages.at(-1).content).toContain('Object Project__c')
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
      'Fields:',
      'StageName picklist フェーズ [Prospecting]',
      'AccountId reference(Account) relationship Account 取引先 ID',
      'CreatedDate datetime readonly 作成日',
      'Child relationships:',
      'OpportunityLineItems -> OpportunityLineItem',
    ])
  })

  it('answers a call of the wrong shape with what is wrong, so that the AI can try again', async () => {
    expect(await runTool(source, 'describeObject', { name: 'Account; DROP' })).toBe('name must be an object API name.')
    expect(await runTool(source, 'describeObject', { name: 'Nope__c' })).toContain('no object named Nope__c')
    expect(await runTool(source, 'findObjects', { keywords: 'x' })).toBe('keywords must be a list of strings.')
    expect(await runTool(source, 'deleteEverything', {})).toBe('There is no tool named deleteEverything.')
  })
})

describe('agent requests', () => {
  it('needs the input of the task, a language and a real time zone', () => {
    expect(invalidAgentRequest(request as unknown as Record<string, unknown>)).toBeUndefined()
    expect(invalidAgentRequest({ ...request, input: { ...request.input, timeZone: 'Mars/Base' } })).toContain('timeZone')
    expect(invalidAgentRequest({ ...request, task: 'deploy' })).toContain('task')
    expect(invalidAgentRequest({ task: 'fixApex', input: { language: 'ja', timeZone: 'Asia/Tokyo', code: 'x' } })).toContain('problem')
  })

  it('takes today in the user time zone', () => {
    expect(todayIn('Asia/Tokyo', new Date('2026-10-18T16:00:00Z'))).toBe('2026-10-19')
    expect(todayIn('America/Los_Angeles', new Date('2026-10-18T16:00:00Z'))).toBe('2026-10-18')
  })
})
