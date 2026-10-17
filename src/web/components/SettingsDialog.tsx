// Settings (docs/screens.md "設定"). The AI section comes in milestone 3.
import { useEffect, useId, useRef, useState } from 'react'
import {
  isValidTimeout,
  MAX_TIMEOUT_SECONDS as MAX_TIMEOUT,
  MIN_TIMEOUT_SECONDS as MIN_TIMEOUT,
  type Settings,
} from '../../shared/api.ts'
import { api } from '../apiClient.ts'
import { t } from '../i18n/i18n.ts'
import { DOCUMENTATION_URL, GITHUB_URL } from '../links.ts'
import { useApp } from '../state/AppContext.tsx'
import { useTask } from '../state/useTask.ts'
import { aiDraftValid, aiInput, initialAiDraft, type AiDraft } from '../ai/draft.ts'
import { AiSettings } from './AiSettings.tsx'
import styles from './SettingsDialog.module.css'


export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { handleCommonError, notify, setSettings: setAppSettings } = useApp()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [settings, setSettings] = useState<Settings>()
  const [timeoutText, setTimeoutText] = useState('')
  const [aiDraft, setAiDraft] = useState<AiDraft>(initialAiDraft(undefined))
  // Loading and saving share one task: saving waits for the settings to load,
  // and a second click while saving does nothing.
  const { start, running } = useTask()
  const namespaceId = useId()
  const timeoutId = useId()
  const timeoutNoteId = useId()

  // The latest callbacks, so that loading runs once per opening of the dialog.
  const callbacks = useRef({ handleCommonError, notify, onClose })
  useEffect(() => {
    callbacks.current = { handleCommonError, notify, onClose }
  })

  useEffect(() => {
    dialogRef.current?.showModal?.()
    void start((signal) => api.settings(signal), 'ignore').then((outcome) => {
      if (outcome.kind === 'done') {
        setSettings(outcome.value)
        setTimeoutText(String(outcome.value.requestTimeoutSeconds))
        setAiDraft(initialAiDraft(outcome.value.ai))
      }
      if (outcome.kind === 'error') {
        const { handleCommonError, notify, onClose } = callbacks.current
        if (!handleCommonError(outcome.error)) notify({ message: (outcome.error as Error).message })
        onClose()
      }
    })
  }, [start])

  const timeout = /^\d+$/.test(timeoutText) ? Number(timeoutText) : Number.NaN
  const timeoutValid = isValidTimeout(timeout)

  const save = async () => {
    if (!settings || !timeoutValid || !(aiDraftValid(aiDraft) || !aiDraft.touched)) return
    const update = {
      omitNamespace: settings.omitNamespace,
      requestTimeoutSeconds: timeout,
      // Only when changed: saving other settings keeps "not set up" (docs/ai.md "API").
      ...(aiDraft.touched ? { ai: aiInput(aiDraft) } : {}),
    }
    const outcome = await start((signal) => api.saveSettings(update, signal), 'ignore')
    if (outcome.kind === 'done') {
      setAppSettings(outcome.value)
      onClose()
    }
    if (outcome.kind === 'error' && !handleCommonError(outcome.error)) notify({ message: (outcome.error as Error).message })
  }

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-label={t.settings} onCancel={onClose}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className={styles.head}>
          <h2 className={styles.title}>{t.settings}</h2>
          <button type="button" className={styles.close} aria-label={t.close} onClick={onClose}>
            ×
          </button>
        </div>
        {settings && (
          <>
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>{t.settingsSoql}</h3>
              <label className={styles.check} htmlFor={namespaceId}>
                <input
                  id={namespaceId}
                  type="checkbox"
                  checked={settings.omitNamespace}
                  onChange={(e) => setSettings({ ...settings, omitNamespace: e.target.checked })}
                />
                <span>
                  {t.settingsOmitNamespace}
                  <span className={styles.note}>{t.settingsOmitNamespaceNote}</span>
                </span>
              </label>
            </section>
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>{t.settingsConnection}</h3>
              <label htmlFor={timeoutId}>{t.settingsTimeout}</label>
              <input
                id={timeoutId}
                className={styles.number}
                type="number"
                inputMode="numeric"
                min={MIN_TIMEOUT}
                max={MAX_TIMEOUT}
                step={1}
                value={timeoutText}
                aria-invalid={!timeoutValid}
                aria-describedby={timeoutNoteId}
                onChange={(e) => setTimeoutText(e.target.value)}
              />
              <span id={timeoutNoteId} className={timeoutValid ? styles.note : styles.error}>
                {timeoutValid ? t.settingsTimeoutNote(MIN_TIMEOUT, MAX_TIMEOUT) : t.settingsTimeoutInvalid(MIN_TIMEOUT, MAX_TIMEOUT)}
              </span>
            </section>
            <AiSettings saved={settings.ai} draft={aiDraft} onChange={setAiDraft} />
          </>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={!settings || !timeoutValid || !(aiDraftValid(aiDraft) || !aiDraft.touched) || running}>
            {t.save}
          </button>
        </div>
        <div className={styles.footer}>
          <span className={styles.version}>sfbench {__SFBENCH_VERSION__}</span>
          <a href={DOCUMENTATION_URL} target="_blank" rel="noreferrer">
            {t.documentation}
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href="/licenses.txt" target="_blank" rel="noreferrer">
            {t.licenses}
          </a>
        </div>
      </form>
    </dialog>
  )
}
