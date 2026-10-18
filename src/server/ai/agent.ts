// The AI writing a REST API request or Apex while reading the org's metadata
// through tools (docs/ai-agent.md "サーバー"): the exchange, its limits, and
// the final answer through the submit tool.
import type { AgentOutput, AgentTask, AgentTaskRequest } from '../../shared/api.ts'
import type { StoredAiSettings } from '../store.ts'
import { agentPrompt, checkAgentOutput } from './agentTasks.ts'
import { anthropicConversation } from './anthropic.ts'
import type { Conversation, ConversationRequest, ToolSpec } from './conversation.ts'
import { AiError } from './errors.ts'
import { AI_TIMEOUT_MS } from './generate.ts'
import { openAiConversation } from './openai.ts'
import { METADATA_TOOLS, runTool, type MetadataSource } from './tools.ts'

/** The most metadata tool calls in one request (docs/ai-agent.md). */
export const MAX_TOOL_CALLS = 6
/** The most text the tools return in one request: the same budget as the SOQL AI. */
export const MAX_TOOL_BYTES = 100_000

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
 * The tiny request of "Test connection" for tools (docs/ai-agent.md "接続を試す"):
 * proves the model calls tools, submit included, before the REST API or Apex
 * screen finds out. The org is not read: the tools find nothing.
 */
export const TEST_AGENT_REQUEST: AgentTaskRequest & { task: 'generateApex' } = {
  task: 'generateApex',
  input: { request: 'Print the number 1 with System.debug.', language: 'en', timeZone: 'UTC' },
}
export const NO_METADATA: MetadataSource = { objects: async () => [], describe: async () => undefined }

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
  const prompt = agentPrompt(req, apiVersion, todayIn(req.input.timeZone))
  const submit: ToolSpec = { name: 'submit', description: 'Gives the final answer. Call it once, when done.', schema: prompt.submitSchema }
  const conversation = CONVERSATIONS[ai.provider]({
    apiKey: ai.apiKey,
    model: ai.model,
    system: prompt.system,
    user: prompt.user,
    tools: [...METADATA_TOOLS, submit],
    signal: both,
  })
  let aiCalls = 0
  let toolCalls = 0
  let toolBytes = 0
  let nudged = false
  try {
    // Each turn either calls tools (counted, so it ends) or is the one nudge.
    for (;;) {
      const turn = await conversation.next()
      aiCalls++
      const answer = turn.calls.find((c) => c.name === 'submit')
      if (answer) return { output: checkAgentOutput(req.task, answer.input), aiCalls, toolCalls }
      if (turn.calls.length === 0) {
        if (nudged) throw new AiError('AI_BAD_OUTPUT', 'The AI answered without calling submit.', turn.text)
        nudged = true
        conversation.say('Give your answer by calling the submit tool.')
        continue
      }
      if (toolCalls >= MAX_TOOL_CALLS || toolBytes >= MAX_TOOL_BYTES) {
        if (nudged) throw new AiError('AI_BAD_OUTPUT', `The AI kept reading the org's metadata past the limit (${MAX_TOOL_CALLS} calls).`)
        nudged = true
        // Every call of the turn needs its answer before anything else can be said.
        conversation.answer(turn.calls.map((c) => ({ id: c.id, content: 'Not run: the limit of tool calls is reached. Call submit now with your best answer.' })))
        continue
      }
      const results = []
      for (const call of turn.calls) {
        toolCalls++
        const over = toolCalls > MAX_TOOL_CALLS || toolBytes >= MAX_TOOL_BYTES
        const content = over ? 'Not run: the limit of tool calls is reached. Call submit now.' : await runTool(source, call.name, call.input)
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
