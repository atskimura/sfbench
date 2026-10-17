// Runs one request at a time for one piece of state (docs/web.md "非同期の流れ").
// Whether a request may still count is decided here only: a request that was
// replaced, cancelled, or whose component went away ends as 'stale', and its
// progress is dropped. Bodies only call APIs with the signal and return a
// value; callers apply the value when the outcome is 'done'.
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

export type TaskOutcome<T> = { kind: 'done'; value: T } | { kind: 'error'; error: unknown } | { kind: 'stale' }

export type TaskBody<T, P> = (signal: AbortSignal, progress: (value: P) => void) => Promise<T>

const STALE = { kind: 'stale' } as const

export function useTask<P = never>() {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<P>()
  const live = useRef({ current: undefined as AbortController | undefined, mounted: false })

  /** Ends the running request: it becomes stale, and what it showed goes. */
  const stop = useCallback(() => {
    const l = live.current
    l.current?.abort()
    l.current = undefined
    setRunning(false)
    setProgress(undefined)
  }, [])

  const start = useCallback(
    async <T,>(body: TaskBody<T, P>, whileRunning: 'replace' | 'ignore'): Promise<TaskOutcome<T>> => {
      const l = live.current
      if (!l.mounted) return STALE
      // Decided here, not after a render, so that a double click starts once.
      if (l.current && whileRunning === 'ignore') return STALE
      stop()
      const request = new AbortController()
      l.current = request
      setRunning(true)
      const valid = () => l.current === request
      const report = (value: P) => {
        if (valid()) setProgress(() => value)
      }
      try {
        const value = await body(request.signal, report)
        if (!valid()) return STALE
        stop()
        return { kind: 'done', value }
      } catch (error) {
        // Includes the failure that aborting this request causes.
        if (!valid()) return STALE
        stop()
        return { kind: 'error', error }
      }
    },
    [stop],
  )

  const cancel = useCallback(() => {
    if (live.current.current) stop()
  }, [stop])

  // A layout effect runs before every effect, children's included, so that a
  // child may start a request from its first effect. StrictMode runs it again
  // after the simulated unmount, which marks the task alive again.
  useLayoutEffect(() => {
    const l = live.current
    l.mounted = true
    return () => {
      l.mounted = false
      l.current?.abort()
      l.current = undefined
    }
  }, [])

  return { start, cancel, running, progress }
}
