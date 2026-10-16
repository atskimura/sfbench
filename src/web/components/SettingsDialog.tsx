// Settings (docs/screens.md "設定"). The AI section comes in milestone 3.
import { useEffect, useId, useRef, useState } from 'react'
import type { Settings } from '../../shared/api.ts'
import { api } from '../api/client.ts'
import { t } from '../i18n/i18n.ts'
import { DOCUMENTATION_URL, GITHUB_URL } from '../links.ts'
import { useApp } from '../state/AppContext.tsx'
import styles from './SettingsDialog.module.css'

const MIN_TIMEOUT = 10
const MAX_TIMEOUT = 600

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { handleCommonError, notify } = useApp()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [settings, setSettings] = useState<Settings>()
  const [timeoutText, setTimeoutText] = useState('')
  const [saving, setSaving] = useState(false)
  const namespaceId = useId()
  const timeoutId = useId()
  const timeoutNoteId = useId()

  useEffect(() => {
    dialogRef.current?.showModal?.()
    api.settings().then(
      (s) => {
        setSettings(s)
        setTimeoutText(String(s.requestTimeoutSeconds))
      },
      (e: unknown) => {
        if (!handleCommonError(e)) notify({ message: (e as Error).message })
        onClose()
      },
    )
  }, [handleCommonError, notify, onClose])

  const timeout = Number(timeoutText)
  const timeoutValid = /^\d+$/.test(timeoutText) && timeout >= MIN_TIMEOUT && timeout <= MAX_TIMEOUT

  const save = async () => {
    if (!settings || !timeoutValid) return
    setSaving(true)
    try {
      await api.saveSettings({ omitNamespace: settings.omitNamespace, requestTimeoutSeconds: timeout })
      onClose()
    } catch (e) {
      if (!handleCommonError(e)) notify({ message: (e as Error).message })
    } finally {
      setSaving(false)
    }
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
                {timeoutValid ? t.settingsTimeoutNote : t.settingsTimeoutInvalid}
              </span>
            </section>
          </>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={!settings || !timeoutValid || saving}>
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
        </div>
      </form>
    </dialog>
  )
}
