import { api } from '../apiClient.ts'
import { t } from '../i18n/i18n.ts'
import { DOCUMENTATION_URL } from '../links.ts'
import { useApp } from '../state/AppContext.tsx'
import { useOrgs } from '../state/OrgContext.tsx'
import { useTask } from '../state/useTask.ts'
import styles from './Header.module.css'
import { ExternalIcon, GearIcon, HelpIcon, LogoIcon } from './icons.tsx'
import { OrgSwitcher } from './OrgSwitcher.tsx'
import { SettingsDialog } from './SettingsDialog.tsx'

const numberFormat = new Intl.NumberFormat()

export function Header() {
  const { selected, apiUsage } = useOrgs()
  const { settingsOpen, setSettingsOpen, mode, setMode } = useApp()
  const usage = selected ? apiUsage[selected] : undefined

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <LogoIcon />
        <span>{t.appName}</span>
      </div>
      <nav className={styles.modes} aria-label={t.modes}>
        {(['soql', 'rest'] as const).map((m) => (
          <button key={m} type="button" className={styles.mode} aria-current={mode === m ? 'page' : undefined} onClick={() => setMode(m)}>
            {m === 'soql' ? t.modeSoql : t.modeRest}
          </button>
        ))}
      </nav>
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

/**
 * Opens the org's home page, logged in, so that record links work in this
 * browser (docs/web.md "組織を開く"). Keyed by the org, so that a failure
 * arriving after a switch is stale.
 */
function OpenOrgButton() {
  const { selected, reportOrgError } = useOrgs()
  const { start, running: opening } = useTask()
  if (!selected) return null
  const open = async () => {
    const outcome = await start((signal) => api.openOrg(selected, signal), 'ignore')
    if (outcome.kind === 'error') reportOrgError(selected, outcome.error)
  }
  return (
    <button
      type="button"
      className={styles.iconButton}
      aria-label={opening ? t.openingOrg : t.openOrg}
      title={opening ? t.openingOrg : t.openOrg}
      aria-busy={opening}
      disabled={opening}
      onClick={() => void open()}
    >
      <ExternalIcon />
    </button>
  )
}
