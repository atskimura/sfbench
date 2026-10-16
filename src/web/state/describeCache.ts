// describe results in memory, per org. The server caches them too, so losing
// this on a tab reload is fine (docs/web.md "状態の持ち方").
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type DescribeGlobal, type DescribeSObject } from '../apiClient.ts'

const globals = new Map<string, Promise<DescribeGlobal>>()
const objects = new Map<string, Promise<DescribeSObject>>()

const key = (...parts: (string | boolean)[]) => parts.join('\n')

export function describeGlobal(username: string, tooling: boolean, refresh = false): Promise<DescribeGlobal> {
  const k = key(username, tooling)
  let pending = globals.get(k)
  if (!pending || refresh) {
    pending = api.sobjects(username, tooling, refresh)
    globals.set(k, pending)
    const stored = pending
    pending.catch(() => globals.get(k) === stored && globals.delete(k))
  }
  return pending
}

export function describeSObject(username: string, name: string, tooling: boolean, refresh = false): Promise<DescribeSObject> {
  const k = key(username, tooling, name.toLowerCase())
  let pending = objects.get(k)
  if (!pending || refresh) {
    pending = api.describe(username, name, tooling, refresh)
    objects.set(k, pending)
    const stored = pending
    pending.catch(() => objects.get(k) === stored && objects.delete(k))
  }
  return pending
}


export type Loadable<T> = { data?: T; error?: unknown; loading: boolean; reload: () => void }

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
  return {
    data: sameKey ? state.data : undefined,
    error: state.request === request ? state.error : undefined,
    loading: request !== undefined && state.request !== request,
    reload,
  }
}
