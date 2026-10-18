// Anthropic Messages API (docs/ai.md "提供元ごとの呼び出し"). Everything that
// depends on this API's shape stays in this file.
import type { Conversation, ConversationRequest, Turn } from './conversation.ts'
import { AiError, postJson, type ProviderRequest } from './errors.ts'

const ENDPOINT = 'https://api.anthropic.com/v1/messages'
const VERSION = '2023-06-01'
/** Required by the API; a SOQL query and its explanation fit well within it. */
const MAX_TOKENS = 4096

type MessageResponse = {
  content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[]
  stop_reason?: string
}

export async function callAnthropic(req: ProviderRequest): Promise<string> {
  const body = (await postJson(
    ENDPOINT,
    { 'x-api-key': req.apiKey, 'anthropic-version': VERSION },
    {
      model: req.model,
      max_tokens: MAX_TOKENS,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      // Structured outputs: the reply is JSON of this schema, as text.
      output_config: { format: { type: 'json_schema', schema: req.schema } },
    },
    req.signal,
  )) as MessageResponse
  const reply = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')
  if (body.stop_reason === 'refusal') throw new AiError('AI_ERROR', `The model declined to answer. ${reply}`.trim())
  if (body.stop_reason === 'max_tokens') throw new AiError('AI_BAD_OUTPUT', 'The output was cut off at the length limit.', reply)
  return reply
}

/**
 * A conversation with tools (docs/ai-agent.md): `tool_choice` is auto, as some
 * models refuse "any". The final answer is the call of the submit tool,
 * which is strict so that its arguments have the answer's shape.
 */
export function anthropicConversation(req: ConversationRequest): Conversation {
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [{ role: 'user', content: req.user }]
  const tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema, strict: true }))
  return {
    async next(): Promise<Turn> {
      const body = (await postJson(
        ENDPOINT,
        { 'x-api-key': req.apiKey, 'anthropic-version': VERSION },
        { model: req.model, max_tokens: MAX_TOKENS, system: req.system, tools, tool_choice: { type: 'auto' }, messages },
        req.signal,
      )) as MessageResponse
      const content = body.content ?? []
      // The API refuses an empty assistant message before another: an empty turn (seen after tool results) is not kept.
      if (content.length > 0) messages.push({ role: 'assistant', content })
      const text = content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')
      if (body.stop_reason === 'refusal') throw new AiError('AI_ERROR', `The model declined to answer. ${text}`.trim())
      if (body.stop_reason === 'max_tokens') throw new AiError('AI_BAD_OUTPUT', 'The output was cut off at the length limit.', text)
      const calls = content.filter((c) => c.type === 'tool_use').map((c) => ({ id: c.id ?? '', name: c.name ?? '', input: c.input }))
      return { text, calls }
    },
    answer(results) {
      messages.push({ role: 'user', content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content })) })
    },
    say(text) {
      messages.push({ role: 'user', content: text })
    },
  }
}
