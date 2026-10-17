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
  // gone is raised only when the component goes away, so that a start before
  // or during the first render's effects (layout effects included) runs.
  const live = useRef({ controller: undefined as AbortController | undefined, gone: false })

  /** The running request is over: what it showed goes. */
  const finish = useCallback(() => {
    live.current.controller = undefined
    setRunning(false)
    setProgress(undefined)
  }, [])

  /**
   * Stops the running request: it is aborted and becomes stale. Returns
   * whether there was one (a request that has just ended is not stopped).
   */
  const cancel = useCallback(() => {
    const { controller } = live.current
    controller?.abort()
    finish()
    return controller !== undefined
  }, [finish])

  const start = useCallback(
    async <T,>(body: TaskBody<T, P>, whileRunning: 'replace' | 'ignore'): Promise<TaskOutcome<T>> => {
      const l = live.current
      if (l.gone) return STALE
      // Decided here, not after a render, so that a double click starts once.
      if (l.controller && whileRunning === 'ignore') return STALE
      cancel()
      const request = new AbortController()
      l.controller = request
      setRunning(true)
      const valid = () => l.controller === request
      const report = (value: P) => {
        if (valid()) setProgress(() => value)
      }
      try {
        const value = await body(request.signal, report)
        if (!valid()) return STALE
        // Not aborted: a body may still use its signal for what it returned.
        finish()
        return { kind: 'done', value }
      } catch (error) {
        // Includes the failure that aborting this request causes.
        if (!valid()) return STALE
        finish()
        return { kind: 'error', error }
      }
    },
    [cancel, finish],
  )

  // Going away stops the request. StrictMode's simulated unmount and remount
  // runs this cleanup and then the effect again, which brings the task back.
  // (The workspace uses neither Suspense nor Activity, which would hide it
  // without unmounting: see docs/web.md "非同期の流れ".)
  useLayoutEffect(() => {
    const l = live.current
    l.gone = false
    return () => {
      l.gone = true
      cancel()
    }
  }, [cancel])

  return { start, cancel, running, progress }
}
