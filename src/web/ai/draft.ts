// The AI settings being edited in the settings dialog (docs/ai.md "設定画面の AI の欄").
import type { AiKeyProvider, AiProvider, AiSettingsInput, AiSettingsView } from '../../shared/api.ts'

/** The AI settings being edited. */
export type AiDraft = {
  provider: AiProvider
  model: string
  /** A key typed in; empty keeps the saved one. */
  apiKey: string
  clearKey: boolean
  /** Only a touched section is saved, so that saving other settings leaves "not set up" as it is. */
  touched: boolean
  /** What was typed for each provider while the dialog is open, so that switching back brings it back. */
  typed: Partial<Record<AiKeyProvider, { model: string; apiKey: string }>>
}

export function initialAiDraft(saved: AiSettingsView | undefined): AiDraft {
  return { provider: saved?.provider ?? 'off', model: saved?.model ?? '', apiKey: '', clearKey: false, touched: false, typed: {} }
}

/** The provider the saved model was chosen for: the saved provider, or with Off, the one its key is for. */
function savedModelProvider(saved: AiSettingsView | undefined): AiProvider | undefined {
  return saved?.provider === 'off' ? saved.keyProvider : saved?.provider
}

/**
 * Switches the provider: a model ID or a key belongs to one provider, so the
 * fields show the other provider's, as typed in this dialog or as saved, or
 * nothing (docs/ai.md "設定画面の AI の欄").
 */
export function switchProvider(draft: AiDraft, provider: AiProvider, saved: AiSettingsView | undefined): AiDraft {
  if (provider === draft.provider) return draft
  const typed = draft.provider === 'off' ? draft.typed : { ...draft.typed, [draft.provider]: { model: draft.model, apiKey: draft.apiKey } }
  // Off shows no fields: what the last provider had stays, for coming back.
  if (provider === 'off') return { ...draft, provider, typed }
  const back = typed[provider]
  const model = back?.model ?? (savedModelProvider(saved) === provider ? (saved?.model ?? '') : '')
  return { ...draft, provider, model, apiKey: back?.apiKey ?? '', typed }
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
