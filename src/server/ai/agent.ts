// The AI writing SOQL, a REST API request or Apex while reading the org's
// metadata through tools (docs/ai-agent.md "サーバー"): the exchange, its
// limits, and the final answer through the submit tool.
import type { AgentOutput, AgentTask, AgentTaskRequest } from '../../shared/api.ts'
import type { StoredAiSettings } from '../store.ts'
import { agentPrompt, checkAgentOutput, type Given } from './agentTasks.ts'
import { anthropicConversation } from './anthropic.ts'
import type { Conversation, ConversationRequest, ToolSpec } from './conversation.ts'
import { AiError } from './errors.ts'
import { openAiConversation } from './openai.ts'
import { findObject, METADATA_TOOLS, newReadState, readObject, runTool, shown, type MetadataSource, type ReadState } from './tools.ts'

/** Local models are out, but large models can still take minutes (docs/ai.md "API"). */
export const AI_TIMEOUT_MS = 300_000

/** The most metadata tool calls in one request (docs/ai-agent.md). */
export const MAX_TOOL_CALLS = 8
/** The most text the tools return in one request, about 30,000 tokens. */
export const MAX_TOOL_BYTES = 100_000

/** Which limit stops the tools: the number of calls, or the text they return. */
const limitName = (calls: number) => (calls >= MAX_TOOL_CALLS ? `the limit of ${MAX_TOOL_CALLS} tool calls` : `the limit of what the tools return (${MAX_TOOL_BYTES / 1000} KB)`)

const CONVERSATIONS: Record<'anthropic' | 'openai', (req: ConversationRequest) => Conversation> = {
  anthropic: anthropicConversation,
  openai: openAiConversation,
}

const encoder = new TextEncoder()

/** Today in the user's time zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/**
 * The tiny request of "Test connection" (docs/ai-agent.md "接続を確かめる"):
 * proves the model calls tools, submit included, before a screen finds out.
 * The org is not read: the tools find nothing.
 */
export const TEST_AGENT_REQUEST: AgentTaskRequest & { task: 'generateApex' } = {
  task: 'generateApex',
  input: { request: 'Print the number 1 with System.debug.', language: 'en', timeZone: 'UTC' },
}
export const NO_METADATA: MetadataSource = { objects: async () => [], describe: async () => undefined }

/**
 * What the screen named, matched against the org's objects: the open object
 * as a hint, and the fields of the object a failed query read from
 * (docs/ai-agent.md "タスク"). A name the org does not have is left out.
 */
async function givenMetadata(req: AgentTaskRequest, source: MetadataSource, state: ReadState): Promise<Given> {
  if (req.task === 'generateSoql' && req.input.openObject) {
    const open = await findObject(source, req.input.openObject)
    return open ? { openObject: shown(source, open.name) } : {}
  }
  if (req.task === 'fixSoql' && req.input.object) {
    // Within the most of one read, as the AI's own read would be; complete, it counts as read.
    const fields = await readObject(source, req.input.object, MAX_TOOL_BYTES, state)
    return fields ? { fields } : {}
  }
  return {}
}

export type AgentRun<T extends AgentTask> = {
  output: AgentOutput<T>
  /** For the log: counts only. */
  aiCalls: number
  toolCalls: number
}

/**
 * Runs one task. `signal` is the caller's (the web UI going away); the
 * timeout is added here. Throws AiError.
 */
export async function runAgent<T extends AgentTask>(
  ai: StoredAiSettings | undefined,
  req: AgentTaskRequest & { task: T },
  source: MetadataSource,
  apiVersion: string,
  signal: AbortSignal,
  timeoutMs = AI_TIMEOUT_MS,
): Promise<AgentRun<T>> {
  if (!ai || ai.provider === 'off') throw new AiError('AI_NOT_CONFIGURED', 'AI is not set up. Choose an AI in the settings.')
  if (!ai.model.trim()) throw new AiError('AI_NOT_CONFIGURED', 'No model ID is saved for the AI. Enter it in the settings.')
  // Checked again here, not only when saving: a key never goes to a provider it was not entered for.
  if (!ai.apiKey || ai.keyProvider !== ai.provider) throw new AiError('AI_NOT_CONFIGURED', 'No API key is saved for this AI. Enter it in the settings.')

  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), timeoutMs)
  const both = AbortSignal.any([signal, timeout.signal])
  let aiCalls = 0
  let toolCalls = 0
  let toolBytes = 0
  // One nudge each: to call submit at all, and to stop reading past the limit.
  let nudgedToSubmit = false
  let nudgedAtLimit = false
  try {
    // What the AI has read in this request: objects read in full are not sent again.
    const state = newReadState()
    const given = await givenMetadata(req, source, state)
    // Fields given from the start count against the budget as the tools' results do.
    if (given.fields) toolBytes += encoder.encode(given.fields).length
    const prompt = agentPrompt(req, apiVersion, todayIn(req.input.timeZone), given)
    const submit: ToolSpec = { name: 'submit', description: 'Gives the final answer. Call it once, when done.', schema: prompt.submitSchema }
    const conversation = CONVERSATIONS[ai.provider]({
      apiKey: ai.apiKey,
      model: ai.model,
      system: prompt.system,
      user: prompt.user,
      tools: [...METADATA_TOOLS, submit],
      signal: both,
    })
    // Each turn either calls tools (counted, so it ends) or uses up a nudge.
    for (;;) {
      const turn = await conversation.next()
      aiCalls++
      const answer = turn.calls.find((c) => c.name === 'submit')
      if (answer) return { output: checkAgentOutput(req.task, answer.input), aiCalls, toolCalls }
      if (turn.calls.length === 0) {
        if (nudgedToSubmit) throw new AiError('AI_BAD_OUTPUT', 'The AI answered without calling submit.', turn.text)
        nudgedToSubmit = true
        conversation.say('Give your answer by calling the submit tool.')
        continue
      }
      if (toolCalls >= MAX_TOOL_CALLS || toolBytes >= MAX_TOOL_BYTES) {
        if (nudgedAtLimit) throw new AiError('AI_BAD_OUTPUT', `The AI kept reading the org's metadata past the limit (${limitName(toolCalls)}).`)
        nudgedAtLimit = true
        // Every call of the turn needs its answer before anything else can be said.
        conversation.answer(turn.calls.map((c) => ({ id: c.id, content: `Not run: ${limitName(toolCalls)} is reached. Call submit now with your best answer.` })))
        continue
      }
      const results = []
      for (const call of turn.calls) {
        // The screen went away (Cancel, a closed tab): no more reads of the org.
        if (both.aborted) throw both.reason
        toolCalls++
        const over = toolCalls > MAX_TOOL_CALLS || toolBytes >= MAX_TOOL_BYTES
        const content = over ? `Not run: ${limitName(toolCalls)} is reached. Call submit now.` : await runTool(source, call.name, call.input, MAX_TOOL_BYTES - toolBytes, state)
        toolBytes += encoder.encode(content).length
        results.push({ id: call.id, content })
      }
      conversation.answer(results)
    }
  } catch (e) {
    if (timeout.signal.aborted) throw new AiError('AI_TIMEOUT', `The AI did not answer within ${Math.round(timeoutMs / 1000)} seconds.`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}
