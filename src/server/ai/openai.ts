// OpenAI Chat Completions API (docs/ai.md "提供元ごとの呼び出し"). Everything
// that depends on this API's shape stays in this file.
import type { Conversation, ConversationRequest, Turn } from './conversation.ts'
import { AiError, postJson, type ProviderRequest } from './errors.ts'

const ENDPOINT = 'https://api.openai.com/v1/chat/completions'

type ToolCallJson = { id?: string; type?: string; function?: { name?: string; arguments?: string } }

type ChatResponse = {
  choices?: { message?: { content?: string | null; refusal?: string | null; tool_calls?: ToolCallJson[] }; finish_reason?: string }[]
}

export async function callOpenAi(req: ProviderRequest): Promise<string> {
  const body = (await postJson(
    ENDPOINT,
    { authorization: `Bearer ${req.apiKey}` },
    {
      model: req.model,
      // No max_tokens or temperature: reasoning models reject them (docs/ai.md).
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      response_format: { type: 'json_schema', json_schema: { name: req.schemaName, schema: req.schema, strict: true } },
    },
    req.signal,
  )) as ChatResponse
  const choice = body.choices?.[0]
  if (choice?.message?.refusal) throw new AiError('AI_ERROR', `The model declined to answer. ${choice.message.refusal}`)
  const reply = choice?.message?.content ?? ''
  if (choice?.finish_reason === 'content_filter') throw new AiError('AI_ERROR', "The provider's content filter blocked the output.")
  if (choice?.finish_reason === 'length') throw new AiError('AI_BAD_OUTPUT', 'The output was cut off at the length limit.', reply)
  return reply
}

/**
 * A conversation with tools (docs/ai-agent.md), on Chat Completions: the
 * tools are strict functions, and their arguments come as JSON text. Not yet
 * tried against OpenAI itself (no key at hand): the shapes follow its
 * documentation.
 */
export function openAiConversation(req: ConversationRequest): Conversation {
  const messages: object[] = [
    { role: 'system', content: req.system },
    { role: 'user', content: req.user },
  ]
  const tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema, strict: true } }))
  return {
    async next(): Promise<Turn> {
      const body = (await postJson(
        ENDPOINT,
        { authorization: `Bearer ${req.apiKey}` },
        { model: req.model, messages, tools, tool_choice: 'auto' },
        req.signal,
      )) as ChatResponse
      const choice = body.choices?.[0]
      const message = choice?.message ?? {}
      // An assistant message needs its content unless it calls tools: an empty turn is not kept.
      if (message.content || message.tool_calls?.length) {
        messages.push({ role: 'assistant', content: message.content ?? null, ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) })
      }
      if (message.refusal) throw new AiError('AI_ERROR', `The model declined to answer. ${message.refusal}`)
      if (choice?.finish_reason === 'content_filter') throw new AiError('AI_ERROR', "The provider's content filter blocked the output.")
      if (choice?.finish_reason === 'length') throw new AiError('AI_BAD_OUTPUT', 'The output was cut off at the length limit.', message.content ?? '')
      const calls = (message.tool_calls ?? []).map((c) => {
        let input: unknown
        try {
          input = JSON.parse(c.function?.arguments ?? '')
        } catch {
          // Not JSON: agent.ts tells the AI so, as with any arguments of the wrong shape.
          input = undefined
        }
        return { id: c.id ?? '', name: c.function?.name ?? '', input }
      })
      return { text: message.content ?? '', calls }
    },
    answer(results) {
      for (const r of results) messages.push({ role: 'tool', tool_call_id: r.id, content: r.content })
    },
    say(text) {
      messages.push({ role: 'user', content: text })
    },
  }
}
