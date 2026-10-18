// Whether the AI input is shown and usable (docs/ai.md "設定", docs/screens.md).
import type { Settings } from '../../shared/api.ts'

/**
 * hidden: the user chose Off, or the settings are still loading (so that the
 * set-up notice does not flash on every launch). setup: not set up yet, or no
 * model or key. ready: AI can be called.
 */
export type AiAvailability = 'hidden' | 'setup' | 'ready'

export function availabilityOf(settings: Settings | undefined): AiAvailability {
  if (!settings) return 'hidden'
  const ai = settings.ai
  if (!ai) return 'setup'
  if (ai.provider === 'off') return 'hidden'
  return ai.model && ai.hasApiKey && ai.keyProvider === ai.provider ? 'ready' : 'setup'
}
