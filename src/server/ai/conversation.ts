// A conversation in which the AI calls tools (docs/ai-agent.md "提供元ごとの呼び出し"):
// the same for every provider, so that agent.ts does not know their shapes.

export type ToolSpec = {
  name: string
  description: string
  /** JSON Schema of the arguments (OpenAI strict-mode rules, docs/ai.md "出力の形"). */
  schema: object
}

export type ToolCall = { id: string; name: string; input: unknown }

/** One reply of the AI: its text, and the tools it called. */
export type Turn = { text: string; calls: ToolCall[] }

export type ConversationRequest = {
  apiKey: string
  model: string
  system: string
  user: string
  tools: ToolSpec[]
  signal: AbortSignal
}

export type Conversation = {
  /** Sends what the conversation holds and adds the AI's reply to it. */
  next: () => Promise<Turn>
  /** Answers the tool calls of the last reply. */
  answer: (results: { id: string; content: string }[]) => void
  /** Adds a message from the user (a nudge to call submit). */
  say: (text: string) => void
}
