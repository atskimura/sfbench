// The AI section of the settings (docs/screens.md "設定", docs/ai.md "設定画面の AI の欄").
import { useEffect, useId, useRef, useState } from 'react'
import { AI_PROVIDERS, type AiKeyProvider, type AiSettingsView } from '../../shared/api.ts'
import { aiDraftValid, aiInput, type AiDraft } from '../ai/draft.ts'
import { ApiRequestError, api } from '../apiClient.ts'
import { t } from '../i18n/i18n.ts'
import styles from './SettingsDialog.module.css'

const MODEL_DOCS: Record<AiKeyProvider, string> = {
  anthropic: 'https://platform.claude.com/docs/en/about-claude/models/overview',
  openai: 'https://developers.openai.com/api/docs/models',
}

type TestState = { state: 'idle' } | { state: 'testing' } | { state: 'ok'; ms: number } | { state: 'error'; message: string }

export function AiSettings({ saved, draft, onChange }: { saved: AiSettingsView | undefined; draft: AiDraft; onChange: (draft: AiDraft) => void }) {
  const ids = { model: useId(), key: useId(), notes: useId() }
  const [test, setTest] = useState<TestState>({ state: 'idle' })
  const testAbort = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => testAbort.current?.abort(), [])

  const change = (patch: Partial<AiDraft>) => {
    // A test still running checks settings that are no longer on screen.
    testAbort.current?.abort()
    setTest({ state: 'idle' })
    onChange({ ...draft, ...patch, touched: true })
  }
  const on = draft.provider !== 'off'
  // The saved key goes only to the provider it was entered for (docs/ai.md).
  const savedKeyUsable = Boolean(saved?.hasApiKey && saved.keyProvider === draft.provider && !draft.clearKey)
  const savedKeyElsewhere = Boolean(on && saved?.hasApiKey && saved.keyProvider !== draft.provider)
  const canTest = on && aiDraftValid(draft) && (draft.apiKey.trim() !== '' || savedKeyUsable)

  const runTest = async () => {
    testAbort.current?.abort()
    const abort = new AbortController()
    testAbort.current = abort
    setTest({ state: 'testing' })
    try {
      const { elapsedMs } = await api.aiTest({ ai: aiInput(draft) }, abort.signal)
      setTest({ state: 'ok', ms: elapsedMs })
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'ABORTED') return
      setTest({ state: 'error', message: (e as Error).message })
    }
  }

  return (
    <section className={styles.section} aria-describedby={ids.notes}>
      <h3 className={styles.sectionTitle}>{t.settingsAi}</h3>
      <div className={styles.choices} role="radiogroup" aria-label={t.settingsAi}>
        {AI_PROVIDERS.map((provider) => (
          <label key={provider} className={styles.check}>
            <input type="radio" name="ai-provider" checked={draft.provider === provider} onChange={() => change({ provider })} />
            {t.aiProviderName[provider]}
          </label>
        ))}
      </div>
      {on && (
        <>
          <label htmlFor={ids.model}>{t.aiModel}</label>
          <input
            id={ids.model}
            className={styles.text}
            value={draft.model}
            aria-invalid={!aiDraftValid(draft)}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => change({ model: e.target.value })}
          />
          {/* The list is needed most before anything is typed, so it is always shown. */}
          <span className={styles.note}>
            <a href={MODEL_DOCS[draft.provider as AiKeyProvider]} target="_blank" rel="noreferrer">
              {t.aiModelList}
            </a>
          </span>
          {!aiDraftValid(draft) && <span className={styles.error}>{t.aiModelRequired}</span>}
          <label htmlFor={ids.key}>{t.aiKey}</label>
          <div className={styles.row}>
            <input
              id={ids.key}
              className={styles.text}
              type="password"
              value={draft.apiKey}
              placeholder={savedKeyUsable ? t.aiKeySaved : ''}
              autoComplete="off"
              onChange={(e) => change({ apiKey: e.target.value, clearKey: false })}
            />
            {savedKeyUsable && (
              <button type="button" className={styles.button} onClick={() => change({ clearKey: true, apiKey: '' })}>
                {t.aiKeyClear}
              </button>
            )}
          </div>
          {savedKeyElsewhere && <span className={styles.error}>{t.aiKeyOtherProvider}</span>}
          <div className={styles.row}>
            <button type="button" className={styles.button} disabled={!canTest || test.state === 'testing'} onClick={() => void runTest()}>
              {test.state === 'testing' ? t.aiTesting : t.aiTest}
            </button>
            <span role="status" className={test.state === 'error' ? styles.error : styles.note}>
              {test.state === 'ok' && t.aiTestOk((test.ms / 1000).toFixed(1))}
              {test.state === 'error' && test.message}
            </span>
          </div>
        </>
      )}
      <ul id={ids.notes} className={styles.notes}>
        <li>{t.aiNoteOff}</li>
        <li>{t.aiNoteCost}</li>
        <li>{t.aiNoteSent}</li>
        <li>{t.aiNoteKey}</li>
        {on && <li>{t.aiNoteTest}</li>}
      </ul>
    </section>
  )
}
