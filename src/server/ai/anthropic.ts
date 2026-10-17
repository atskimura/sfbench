// Anthropic Messages API (docs/ai.md "提供元ごとの呼び出し"). Everything that
// depends on this API's shape stays in this file.
import { AiError, postJson, type ProviderRequest } from './errors.ts'

const ENDPOINT = 'https://api.anthropic.com/v1/messages'
const VERSION = '2023-06-01'
/** Required by the API; a SOQL query and its explanation fit well within it. */
const MAX_TOKENS = 4096

type MessageResponse = {
  content?: { type: string; text?: string }[]
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
