// Calls the configured AI for a task and returns its checked output
// (docs/ai.md "サーバー").
import type { AiOutput, AiTask, AiTaskRequest } from '../../shared/api.ts'
import type { StoredAiSettings } from '../store.ts'
import { callAnthropic } from './anthropic.ts'
import { AiError } from './errors.ts'
import { callOpenAi } from './openai.ts'
import { checkOutput, promptFor } from './tasks.ts'

/** Local models are out, but large models can still take minutes (docs/ai.md "API"). */
export const AI_TIMEOUT_MS = 300_000

const CALLERS = { anthropic: callAnthropic, openai: callOpenAi }

/**
 * Runs one task. `signal` is the caller's (the web UI going away); the
 * timeout is added here. Throws AiError.
 */
export async function generate<T extends AiTask>(
  ai: StoredAiSettings | undefined,
  req: AiTaskRequest & { task: T },
  signal: AbortSignal,
  timeoutMs = AI_TIMEOUT_MS,
): Promise<AiOutput<T>> {
  if (!ai || ai.provider === 'off') throw new AiError('AI_NOT_CONFIGURED', 'AI is not set up. Choose an AI in the settings.')
  if (!ai.model.trim()) throw new AiError('AI_NOT_CONFIGURED', 'No model ID is saved for the AI. Enter it in the settings.')
  // Checked again here, not only when saving: a key never goes to a provider it was not entered for.
  if (!ai.apiKey || ai.keyProvider !== ai.provider) {
    throw new AiError('AI_NOT_CONFIGURED', 'No API key is saved for this AI. Enter it in the settings.')
  }
  // A timer cleared when done, rather than AbortSignal.timeout, which lives on for the full time.
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), timeoutMs)
  const both = AbortSignal.any([signal, timeout.signal])
  const prompt = promptFor(req)
  try {
    const text = await CALLERS[ai.provider]({ apiKey: ai.apiKey, model: ai.model, ...prompt, signal: both })
    return checkOutput(req, text) as AiOutput<T>
  } catch (e) {
    if (timeout.signal.aborted) throw new AiError('AI_TIMEOUT', `The AI did not answer within ${Math.round(timeoutMs / 1000)} seconds.`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** The tiny request of "Test connection": also proves the model accepts the output schema. */
export const TEST_REQUEST: AiTaskRequest & { task: 'generateSoql' } = {
  task: 'generateSoql',
  input: {
    request: 'List the names of five accounts.',
    objectInfo: 'Object Account (Account)\nFields:\nId id\nName string Account Name',
    editorText: '',
    tooling: false,
    language: 'en',
  },
}
