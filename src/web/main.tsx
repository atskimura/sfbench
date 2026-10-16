import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { startup } from './bootstrap.ts'
import { StartupMessage } from './components/StartupMessage.tsx'
import { t } from './i18n/i18n.ts'
import './styles/tokens.css'

const root = createRoot(document.getElementById('root')!)

startup(window.location, window.history).then((result) => {
  root.render(
    <StrictMode>
      {result.kind === 'ready' ? (
        <App launch={result.launch} />
      ) : (
        <StartupMessage
          message={
            result.kind === 'expired'
              ? t.launchExpired
              : result.kind === 'noSession'
                ? t.noSession
                : result.message
          }
        />
      )}
    </StrictMode>,
  )
})
