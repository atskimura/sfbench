// describe results in memory, per org. The server caches them too, so losing
// this on a tab reload is fine (docs/web.md "状態の持ち方").
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type DescribeGlobal, type DescribeSObject } from '../apiClient.ts'

const globals = new Map<string, Promise<DescribeGlobal>>()
const versions = new Map<string, Promise<string[]>>()
const objects = new Map<string, Promise<DescribeSObject>>()

const key = (...parts: (string | boolean)[]) => parts.join('\n')

/** `version` is the API version chosen, undefined for the latest (docs/web.md "API バージョン"). */
export function describeGlobal(username: string, tooling: boolean, version: string | undefined, refresh = false): Promise<DescribeGlobal> {
  const k = key(username, tooling, version ?? '')
  let pending = globals.get(k)
  if (!pending || refresh) {
    pending = api.sobjects(username, tooling, version, refresh)
    globals.set(k, pending)
    const stored = pending
    pending.catch(() => globals.get(k) === stored && globals.delete(k))
  }
  return pending
}

export function describeSObject(username: string, name: string, tooling: boolean, version: string | undefined, refresh = false): Promise<DescribeSObject> {
  const k = key(username, tooling, version ?? '', name.toLowerCase())
  let pending = objects.get(k)
  if (!pending || refresh) {
    pending = api.describe(username, name, tooling, version, refresh)
    objects.set(k, pending)
    const stored = pending
    pending.catch(() => objects.get(k) === stored && objects.delete(k))
  }
  return pending
}

/** The API versions the org supports, oldest first: asked once per tab. */
export function apiVersions(username: string): Promise<string[]> {
  let pending = versions.get(username)
  if (!pending) {
    pending = api.versions(username).then((res) => res.versions)
    versions.set(username, pending)
    const stored = pending
    pending.catch(() => versions.get(username) === stored && versions.delete(username))
  }
  return pending
}

/** Forgets every describe, as a new tab would (used between tests). */
export function clearDescribeCache(): void {
  globals.clear()
  objects.clear()
  versions.clear()
}

export type Loadable<T> = {
  data?: T
  error?: unknown
  /** A request for this key is running (a first load or a reload). */
  loading: boolean
  /** Nothing to show for this key and a request is running (a first load, or a reload after a failure). Panels say "loading" for this. */
  pending: boolean
  reload: () => void
}

/**
 * Loads data identified by `key` (undefined: nothing to load). Loads again
 * when the key changes; `reload()` asks the server to fetch fresh data.
 */
export function useLoadable<T>(key: string | undefined, load: (refresh: boolean) => Promise<T>): Loadable<T> {
  const [reloads, setReloads] = useState(0)
  // The result and the request (key and reload count) it answers.
  const [state, setState] = useState<{ key?: string; request?: string; data?: T; error?: unknown }>({})
  const request = key === undefined ? undefined : `${key}\n${reloads}`
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })
  useEffect(() => {
    if (key === undefined) return
    let active = true
    loadRef.current(reloads > 0).then(
      (data) => active && setState({ key, request: `${key}\n${reloads}`, data }),
      // A failed reload keeps the data already shown.
      (error: unknown) =>
        active && setState((prev) => ({ key, request: `${key}\n${reloads}`, data: prev.key === key ? prev.data : undefined, error })),
    )
    return () => {
      active = false
    }
  }, [key, reloads])
  const reload = useCallback(() => setReloads((n) => n + 1), [])
  // While reloading, the previous data for the same key stays visible.
  const sameKey = key !== undefined && state.key === key
  const data = sameKey ? state.data : undefined
  const error = state.request === request ? state.error : undefined
  const loading = request !== undefined && state.request !== request
  return { data, error, loading, pending: loading && data === undefined, reload }
}
