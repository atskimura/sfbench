// Decides what to show at startup, before React renders. The one-time launch
// code is exchanged here, exactly once: inside React, StrictMode's double
// effects would send it twice and the second exchange would fail.
// See docs/web.md ("起動から作業画面まで").
import type { LaunchOptions } from '../shared/api.ts'
import { ApiRequestError, api, getSessionToken } from './apiClient.ts'
import { t } from './i18n/i18n.ts'

export type Startup =
  /** `launch` is present when opened from `npx sfbench`, absent on a tab reload. */
  | { kind: 'ready'; launch?: LaunchOptions }
  | { kind: 'expired' }
  | { kind: 'noSession' }
  | { kind: 'error'; message: string }

export async function startup(location: Location, history: History): Promise<Startup> {
  const match = /^\/launch\/([^/]+)$/.exec(location.pathname)
  if (match) {
    try {
      const { launch } = await api.exchangeLaunchCode(decodeURIComponent(match[1]))
      history.replaceState(null, '', '/')
      return { kind: 'ready', launch }
    } catch (e) {
      history.replaceState(null, '', '/')
      if (e instanceof ApiRequestError && e.status === 410) return { kind: 'expired' }
      // The server cannot be reached or failed: the same guidance as a lost session.
      return { kind: 'error', message: t.sessionLost }
    }
  }
  return getSessionToken() ? { kind: 'ready' } : { kind: 'noSession' }
}
