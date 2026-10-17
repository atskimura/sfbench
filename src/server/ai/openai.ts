// OpenAI Chat Completions API (docs/ai.md "提供元ごとの呼び出し"). Everything
// that depends on this API's shape stays in this file.
import { AiError, postJson, type ProviderRequest } from './errors.ts'

const ENDPOINT = 'https://api.openai.com/v1/chat/completions'

type ChatResponse = {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[]
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
