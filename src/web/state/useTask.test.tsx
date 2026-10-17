// @vitest-environment jsdom
// One test per row of the useTask table in docs/web.md "非同期の流れ".
import { act, render, renderHook } from '@testing-library/react'
import { StrictMode, useEffect } from 'react'
import { describe, expect, it } from 'vitest'
import { useTask, type TaskOutcome } from './useTask.ts'

/** A body whose runs are settled by hand. */
function controlled<T, P = never>() {
  const runs: { signal: AbortSignal; progress: (p: P) => void; resolve: (v: T) => void; reject: (e: unknown) => void }[] = []
  const body = (signal: AbortSignal, progress: (p: P) => void) =>
    new Promise<T>((resolve, reject) => runs.push({ signal, progress, resolve, reject }))
  return { body, runs }
}

describe('useTask', () => {
  it('idle → running on start, then done with the value; progress is cleared', async () => {
    const { result } = renderHook(() => useTask<number>())
    const { body, runs } = controlled<string, number>()
    let outcome: TaskOutcome<string> | undefined
    act(() => {
      void result.current.start(body, 'replace').then((o) => (outcome = o))
    })
    expect(result.current.running).toBe(true)
    act(() => runs[0].progress(5))
    expect(result.current.progress).toBe(5)
    await act(async () => runs[0].resolve('A'))
    expect(outcome).toEqual({ kind: 'done', value: 'A' })
    expect(result.current.running).toBe(false)
    expect(result.current.progress).toBeUndefined()
  })

  it('a failure that the task did not cause is an error', async () => {
    const { result } = renderHook(() => useTask())
    const { body, runs } = controlled<string>()
    let outcome: TaskOutcome<string> | undefined
    act(() => {
      void result.current.start(body, 'replace').then((o) => (outcome = o))
    })
    await act(async () => runs[0].reject(new Error('x')))
    expect(outcome).toMatchObject({ kind: 'error' })
    expect(result.current.running).toBe(false)
  })

  it('replace: aborts the running request, which becomes stale even if it answers', async () => {
    const { result } = renderHook(() => useTask<number>())
    const { body, runs } = controlled<string, number>()
    const outcomes: TaskOutcome<string>[] = []
    act(() => {
      void result.current.start(body, 'replace').then((o) => outcomes.push(o))
    })
    act(() => runs[0].progress(1))
    act(() => {
      void result.current.start(body, 'replace').then((o) => outcomes.push(o))
    })
    expect(runs[0].signal.aborted).toBe(true)
    expect(result.current.progress).toBeUndefined()
    await act(async () => runs[0].resolve('old'))
    act(() => runs[0].progress(9))
    expect(result.current.progress).toBeUndefined()
    await act(async () => runs[1].resolve('new'))
    expect(outcomes).toEqual([{ kind: 'stale' }, { kind: 'done', value: 'new' }])
  })

  it('ignore: a second start while running, even in the same act, is stale and does not run', async () => {
    const { result } = renderHook(() => useTask())
    const { body, runs } = controlled<string>()
    let second: TaskOutcome<string> | undefined
    act(() => {
      void result.current.start(body, 'ignore')
      void result.current.start(body, 'ignore').then((o) => (second = o))
    })
    await act(async () => {})
    expect(runs).toHaveLength(1)
    expect(second).toEqual({ kind: 'stale' })
  })

  it('cancel: aborts, goes idle, and the late answer or failure is stale', async () => {
    const { result } = renderHook(() => useTask<number>())
    const { body, runs } = controlled<string, number>()
    const outcomes: TaskOutcome<string>[] = []
    act(() => {
      void result.current.start(body, 'replace').then((o) => outcomes.push(o))
      void result.current.start(body, 'replace').then((o) => outcomes.push(o))
    })
    act(() => runs[1].progress(3))
    act(() => result.current.cancel())
    expect(runs[1].signal.aborted).toBe(true)
    expect(result.current).toMatchObject({ running: false, progress: undefined })
    await act(async () => runs[1].reject(new DOMException('aborted', 'AbortError')))
    await act(async () => runs[0].resolve('replaced'))
    expect(outcomes).toEqual([{ kind: 'stale' }, { kind: 'stale' }])
  })

  it('cancel while idle does nothing', () => {
    const { result } = renderHook(() => useTask())
    act(() => result.current.cancel())
    expect(result.current.running).toBe(false)
  })

  it('unmount: aborts the request, and a start afterwards is stale without running', async () => {
    const { result, unmount } = renderHook(() => useTask())
    const { body, runs } = controlled<string>()
    const start = result.current.start
    let outcome: TaskOutcome<string> | undefined
    act(() => {
      void start(body, 'replace').then((o) => (outcome = o))
    })
    unmount()
    expect(runs[0].signal.aborted).toBe(true)
    await act(async () => runs[0].resolve('late'))
    expect(outcome).toEqual({ kind: 'stale' })
    await expect(start(body, 'replace')).resolves.toEqual({ kind: 'stale' })
    expect(runs).toHaveLength(1)
  })

  it('a start from a child effect right after mounting runs; under StrictMode the first run is stale', async () => {
    const { body, runs } = controlled<string>()
    const outcomes: TaskOutcome<string>[] = []
    function Child({ start }: { start: ReturnType<typeof useTask<never>>['start'] }) {
      useEffect(() => {
        void start(body, 'replace').then((o) => outcomes.push(o))
      }, [start])
      return null
    }
    function Parent() {
      const task = useTask<never>()
      return (
        <>
          <output>{String(task.running)}</output>
          <Child start={task.start} />
        </>
      )
    }
    const view = render(
      <StrictMode>
        <Parent />
      </StrictMode>,
    )
    // StrictMode mounts, unmounts and mounts again: the first run is aborted.
    expect(runs).toHaveLength(2)
    expect(runs[0].signal.aborted).toBe(true)
    expect(runs[1].signal.aborted).toBe(false)
    expect(view.container.querySelector('output')?.textContent).toBe('true')
    await act(async () => {
      runs[0].resolve('first')
      runs[1].resolve('second')
    })
    expect(outcomes).toEqual([{ kind: 'stale' }, { kind: 'done', value: 'second' }])
  })

  it('an abort the task did not cause (another signal) is an error, not stale', async () => {
    const { result } = renderHook(() => useTask())
    let outcome: TaskOutcome<string> | undefined
    await act(async () => {
      outcome = await result.current.start(async () => {
        throw new DOMException('aborted elsewhere', 'AbortError')
      }, 'replace')
    })
    expect(outcome).toMatchObject({ kind: 'error' })
  })

  it('a finished request is not aborted', async () => {
    const { result } = renderHook(() => useTask())
    const { body, runs } = controlled<string>()
    act(() => void result.current.start(body, 'replace'))
    await act(async () => runs[0].resolve('A'))
    expect(runs[0].signal.aborted).toBe(false)
  })

  it('a body that throws synchronously is an error, not a thrown start', async () => {
    const { result } = renderHook(() => useTask())
    let outcome: TaskOutcome<never> | undefined
    await act(async () => {
      outcome = await result.current.start(() => {
        throw new Error('sync')
      }, 'replace')
    })
    expect(outcome).toMatchObject({ kind: 'error' })
    expect(result.current.running).toBe(false)
  })

  it('start and cancel keep their identity across renders', () => {
    const { result, rerender } = renderHook(() => useTask())
    const first = result.current
    rerender()
    expect(result.current.start).toBe(first.start)
    expect(result.current.cancel).toBe(first.cancel)
  })
})
