// The AI settings being edited in the settings dialog (docs/ai.md "設定画面の AI の欄").
import type { AiProvider, AiSettingsInput, AiSettingsView } from '../../shared/api.ts'

/** The AI settings being edited. */
export type AiDraft = {
  provider: AiProvider
  model: string
  /** A key typed in; empty keeps the saved one. */
  apiKey: string
  clearKey: boolean
  /** Only a touched section is saved, so that saving other settings leaves "not set up" as it is. */
  touched: boolean
}

export function initialAiDraft(saved: AiSettingsView | undefined): AiDraft {
  return { provider: saved?.provider ?? 'off', model: saved?.model ?? '', apiKey: '', clearKey: false, touched: false }
}

export function aiInput(draft: AiDraft): AiSettingsInput {
  const input: AiSettingsInput = { provider: draft.provider, model: draft.model.trim() }
  if (draft.clearKey) input.apiKey = null
  else if (draft.apiKey.trim()) input.apiKey = draft.apiKey.trim()
  return input
}

/** Whether the draft can be saved: a provider other than Off needs a model. */
export function aiDraftValid(draft: AiDraft): boolean {
  return draft.provider === 'off' || draft.model.trim() !== ''
}
