import type { LaunchOptions } from '../shared/api.ts'
import styles from './App.module.css'
import { Banners } from './components/Banners.tsx'
import { ConfirmDialog } from './components/ConfirmDialog.tsx'
import { Header } from './components/Header.tsx'
import { Notifications } from './components/Notifications.tsx'
import { StartupMessage } from './components/StartupMessage.tsx'
import { Workspace } from './components/Workspace.tsx'
import { t } from './i18n/i18n.ts'
import { AppProvider, useApp } from './state/AppContext.tsx'
import { OrgProvider } from './state/OrgContext.tsx'

export function App({ launch }: { launch: LaunchOptions | undefined }) {
  return (
    <AppProvider initialMode={launch?.rest ? 'rest' : launch?.apex ? 'apex' : undefined}>
      <OrgProvider launch={launch}>
        <Shell />
      </OrgProvider>
    </AppProvider>
  )
}

function Shell() {
  const { sfNotFound } = useApp()
  if (sfNotFound) {
    return (
      <StartupMessage message={t.sfNotFound}>
        <a href="https://developer.salesforce.com/tools/salesforcecli" target="_blank" rel="noreferrer">
          {t.installSf}
        </a>
      </StartupMessage>
    )
  }
  return (
    <div className={styles.app}>
      <Header />
      <Banners />
      <main className={styles.main}>
        <Workspace />
      </main>
      <Notifications />
      <DiscardDialog />
    </div>
  )
}

/** Asks before changes not saved in the result table go (docs/edit.md "保存していない変更を捨てる前の確認"). */
function DiscardDialog() {
  const { discarding, confirmDiscard, cancelDiscard } = useApp()
  if (!discarding) return null
  return <ConfirmDialog title={t.discardTitle} message={t.discardMessage(discarding.count)} confirmLabel={t.discardConfirm} onConfirm={confirmDiscard} onCancel={cancelDiscard} />
}
