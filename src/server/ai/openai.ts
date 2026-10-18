// OpenAI Responses API (docs/ai-agent.md "提供元ごとの呼び出し"). Everything
// that depends on this API's shape stays in this file.
import type { Conversation, ConversationRequest, Turn } from './conversation.ts'
import { AiError, postJson } from './errors.ts'

const RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses'

type ResponseItem = {
  type?: string
  call_id?: string
  name?: string
  arguments?: string
  content?: { type?: string; text?: string; refusal?: string }[]
}

type ResponsesReply = {
  status?: string
  incomplete_details?: { reason?: string } | null
  output?: ResponseItem[]
}

/**
 * A conversation with tools (docs/ai-agent.md), on the Responses API:
 * reasoning models take function tools only there, not on Chat Completions
 * (gpt-6-luna refuses them). Nothing is kept by OpenAI (store: false): each
 * call sends the whole conversation, with the reasoning of earlier replies
 * as OpenAI encrypted it, so that the model keeps its own thread.
 */
export function openAiConversation(req: ConversationRequest): Conversation {
  const input: object[] = [{ role: 'user', content: req.user }]
  const tools = req.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.schema, strict: true }))
  return {
    async next(): Promise<Turn> {
      const body = (await postJson(
        RESPONSES_ENDPOINT,
        { authorization: `Bearer ${req.apiKey}` },
        { model: req.model, instructions: req.system, input, tools, tool_choice: 'auto', store: false, include: ['reasoning.encrypted_content'] },
        req.signal,
      )) as ResponsesReply
      const output = body.output ?? []
      // Every item goes back as it came: the reasoning, the calls, the text.
      input.push(...output)
      const parts = output.filter((o) => o.type === 'message').flatMap((o) => o.content ?? [])
      const text = parts.filter((c) => c.type === 'output_text').map((c) => c.text ?? '').join('')
      const refusal = parts.find((c) => c.type === 'refusal')?.refusal
      if (refusal) throw new AiError('AI_ERROR', `The model declined to answer. ${refusal}`)
      if (body.status === 'incomplete') {
        const reason = body.incomplete_details?.reason
        if (reason === 'content_filter') throw new AiError('AI_ERROR', "The provider's content filter blocked the output.")
        throw new AiError('AI_BAD_OUTPUT', 'The output was cut off at the length limit.', text)
      }
      const calls = output
        .filter((o) => o.type === 'function_call')
        .map((o) => {
          let parsed: unknown
          try {
            parsed = JSON.parse(o.arguments ?? '')
          } catch {
            // Not JSON: agent.ts tells the AI so, as with any arguments of the wrong shape.
            parsed = undefined
          }
          return { id: o.call_id ?? '', name: o.name ?? '', input: parsed }
        })
      return { text, calls }
    },
    answer(results) {
      for (const r of results) input.push({ type: 'function_call_output', call_id: r.id, output: r.content })
    },
    say(text) {
      input.push({ role: 'user', content: text })
    },
  }
}
