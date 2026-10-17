// One way to write every async flow of the web UI (docs/web.md "非同期の流れ").
// Each request gets a number, and only the current number may change the
// state: superseded, cancelled, reset and unmounted requests are dropped here,
// in one place, instead of each flow guarding itself.
import { useCallback, useEffect, useRef, useState } from 'react'

export type FlowStatus = 'idle' | 'running' | 'done' | 'error'

export type FlowState<A, T> = {
  status: FlowStatus
  /** The request that made what is shown; undefined when idle. */
  id?: number
  args?: A
  data?: T
  error?: unknown
}

export type FlowOutcome<T> = { kind: 'done'; data: T } | { kind: 'error'; error: unknown } | { kind: 'stale' }

export type FlowOptions<A> = {
  /** A change aborts the request and drops the result. */
  resetKey?: string | number
  whileRunning: 'replace' | 'ignore'
  /** Within one resetKey, keep the previous data while running again, after a failure and on cancel. */
  keepData?: boolean
  /** Start with these arguments on mount and whenever resetKey changes. */
  auto?: A
}

type Body<A, T> = (args: A, ctx: { signal: AbortSignal; setData: (data: T) => void }) => Promise<T>

/** The state, with the resetKey it belongs to and the request behind the kept data. */
type Inner<A, T> = FlowState<A, T> & { key: string | number | undefined; dataId?: number }

const STALE = { kind: 'stale' } as const

export function useFlow<A, T>(body: Body<A, T>, options: FlowOptions<A>) {
  const [inner, setInner] = useState<Inner<A, T>>(() => ({ key: options.resetKey, status: 'idle' }))
  // Read by start and friends, which outlive the render they were made in.
  const latest = useRef({ body, options })
  const live = useRef({ current: 0, next: 0, running: false, mounted: false, abort: undefined as AbortController | undefined })

  useEffect(() => {
    latest.current = { body, options }
  })

  /** Makes every request so far stale. */
  const invalidate = useCallback(() => {
    const l = live.current
    l.abort?.abort()
    l.abort = undefined
    l.current = 0
    l.running = false
  }, [])

  const start = useCallback(
    async (args: A): Promise<FlowOutcome<T>> => {
      const l = live.current
      const { options: opts } = latest.current
      if (!l.mounted) return STALE
      // Decided here, not after a render, so that a double click starts once.
      if (l.running && opts.whileRunning === 'ignore') return STALE
      l.abort?.abort()
      const id = ++l.next
      const abort = new AbortController()
      Object.assign(l, { current: id, running: true, abort })
      const key = opts.resetKey
      const keep = opts.keepData === true
      setInner((prev) => {
        const kept = keep && prev.key === key ? { data: prev.data, dataId: prev.dataId } : {}
        return { key, status: 'running', id, args, ...kept }
      })
      const valid = () => l.current === id
      const setData = (data: T) => {
        if (valid()) setInner((prev) => (prev.id === id ? { ...prev, data, dataId: id } : prev))
      }
      try {
        const data = await latest.current.body(args, { signal: abort.signal, setData })
        if (!valid()) return STALE
        l.running = false
        setInner({ key, status: 'done', id, args, data, dataId: id })
        return { kind: 'done', data }
      } catch (error) {
        // Includes the failure that aborting causes.
        if (!valid()) return STALE
        l.running = false
        setInner((prev) => ({ key, status: 'error', id, args, error, ...(keep ? { data: prev.data, dataId: prev.dataId } : {}) }))
        return { kind: 'error', error }
      }
    },
    [],
  )

  const cancel = useCallback(() => {
    if (!live.current.running) return
    invalidate()
    setInner((prev) =>
      latest.current.options.keepData && prev.data !== undefined && prev.dataId !== undefined
        ? { key: prev.key, status: 'done', id: prev.dataId, args: prev.args, data: prev.data, dataId: prev.dataId }
        : { key: prev.key, status: 'idle' },
    )
  }, [invalidate])

  const reset = useCallback(() => {
    invalidate()
    setInner((prev) => ({ key: prev.key, status: 'idle' }))
  }, [invalidate])

  const update = useCallback((id: number, change: (data: T) => T) => {
    setInner((prev) =>
      prev.status === 'done' && prev.id === id && prev.key === latest.current.options.resetKey
        ? { ...prev, data: change(prev.data as T) }
        : prev,
    )
  }, [])

  // Declared before the resetKey effect, so that an auto start finds the hook mounted.
  useEffect(() => {
    const l = live.current
    l.mounted = true
    return () => {
      l.mounted = false
      invalidate()
    }
  }, [invalidate])

  const { resetKey, auto } = options
  useEffect(() => {
    if (auto !== undefined) void start(auto)
    // Leaving this key (or unmounting): its request stops.
    return invalidate
    // auto is read when the key changes, not on every new arguments object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, start, invalidate])

  // A result of another resetKey is never shown, not even before the effect above runs.
  const shown: FlowState<A, T> = inner.key === resetKey ? inner : { status: 'idle' }
  return { status: shown.status, id: shown.id, args: shown.args, data: shown.data, error: shown.error, start, cancel, reset, update }
}
