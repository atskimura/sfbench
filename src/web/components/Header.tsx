import { useState } from 'react'
import { ApiRequestError, api } from '../apiClient.ts'
import { t } from '../i18n/i18n.ts'
import { DOCUMENTATION_URL } from '../links.ts'
import { useApp } from '../state/AppContext.tsx'
import { useOrgs } from '../state/OrgContext.tsx'
import styles from './Header.module.css'
import { ExternalIcon, GearIcon, HelpIcon, LogoIcon } from './icons.tsx'
import { OrgSwitcher } from './OrgSwitcher.tsx'
import { SettingsDialog } from './SettingsDialog.tsx'

const numberFormat = new Intl.NumberFormat()

export function Header() {
  const { selected, apiUsage } = useOrgs()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const usage = selected ? apiUsage[selected] : undefined

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <LogoIcon />
        <span>{t.appName}</span>
      </div>
      <div className={styles.spacer} />
      {usage && (
        <span className={styles.usage}>{t.apiUsage(numberFormat.format(usage.used), numberFormat.format(usage.max))}</span>
      )}
      <OrgSwitcher />
      <OpenOrgButton key={selected} />
      <a className={styles.iconButton} href={DOCUMENTATION_URL} target="_blank" rel="noreferrer" aria-label={t.documentation} title={t.documentation}>
        <HelpIcon />
      </a>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={t.settings}
        title={t.settings}
        onClick={() => setSettingsOpen(true)}
      >
        <GearIcon />
      </button>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </header>
  )
}

/** Opens the org's home page, logged in, so that record links work in this browser (docs/web.md "組織を開く"). */
function OpenOrgButton() {
  const { selected, handleOrgError } = useOrgs()
  const { notify } = useApp()
  const [opening, setOpening] = useState(false)
  if (!selected) return null
  const open = async () => {
    setOpening(true)
    try {
      await api.openOrg(selected)
    } catch (e) {
      if (!handleOrgError(selected, e)) notify({ message: (e as ApiRequestError).message })
    } finally {
      setOpening(false)
    }
  }
  return (
    <button
      type="button"
      className={styles.iconButton}
      aria-label={opening ? t.openingOrg : t.openOrg}
      title={opening ? t.openingOrg : t.openOrg}
      aria-busy={opening}
      disabled={opening}
      onClick={open}
    >
      <ExternalIcon />
    </button>
  )
}
