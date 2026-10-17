// @vitest-environment jsdom
// One test per row of the state table in docs/web.md "非同期の流れ".
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useFlow } from './useFlow.ts'

/** A body whose calls are settled by hand. */
function controlled<T>() {
  const calls: { args: string; signal: AbortSignal; setData: (d: T) => void; resolve: (v: T) => void; reject: (e: unknown) => void }[] = []
  const body = (args: string, ctx: { signal: AbortSignal; setData: (d: T) => void }) =>
    new Promise<T>((resolve, reject) => calls.push({ args, ...ctx, resolve, reject }))
  return { body, calls }
}

type Opts = Parameters<typeof useFlow<string, string>>[1]

function setup(opts: Partial<Opts> = {}, strict = false) {
  const c = controlled<string>()
  const hook = renderHook((props: Partial<Opts>) => useFlow<string, string>(c.body, { whileRunning: 'replace', ...opts, ...props }), {
    initialProps: {},
    reactStrictMode: strict,
  })
  return { ...c, hook }
}

describe('useFlow', () => {
  it('starts from idle, and finishes as done with the data', async () => {
    const { hook, calls } = setup()
    expect(hook.result.current.status).toBe('idle')
    let outcome: unknown
    act(() => {
      void hook.result.current.start('a').then((o) => (outcome = o))
    })
    expect(hook.result.current).toMatchObject({ status: 'running', args: 'a' })
    await act(async () => calls[0].resolve('A'))
    expect(hook.result.current).toMatchObject({ status: 'done', data: 'A', args: 'a' })
    expect(outcome).toEqual({ kind: 'done', data: 'A' })
  })

  it('finishes as error when the body fails', async () => {
    const { hook, calls } = setup()
    let outcome: unknown
    act(() => {
      void hook.result.current.start('a').then((o) => (outcome = o))
    })
    await act(async () => calls[0].reject(new Error('x')))
    expect(hook.result.current.status).toBe('error')
    expect((hook.result.current.error as Error).message).toBe('x')
    expect(outcome).toMatchObject({ kind: 'error' })
  })

  it('replace: aborts the older request and ignores its answer', async () => {
    const { hook, calls } = setup()
    const outcomes: unknown[] = []
    act(() => {
      void hook.result.current.start('a').then((o) => outcomes.push(o))
    })
    act(() => {
      void hook.result.current.start('b')
    })
    expect(calls[0].signal.aborted).toBe(true)
    await act(async () => calls[0].resolve('A'))
    expect(hook.result.current).toMatchObject({ status: 'running', args: 'b' })
    await act(async () => calls[1].resolve('B'))
    expect(hook.result.current.data).toBe('B')
    expect(outcomes).toEqual([{ kind: 'stale' }])
  })

  it('ignore: a second start, even in the same act, does nothing', async () => {
    const { hook, calls } = setup({ whileRunning: 'ignore' })
    let second: unknown
    act(() => {
      void hook.result.current.start('a')
      void hook.result.current.start('b').then((o) => (second = o))
    })
    await act(async () => {})
    expect(calls).toHaveLength(1)
    expect(second).toEqual({ kind: 'stale' })
  })

  it('keepData: keeps the previous data while running again and after a failure', async () => {
    const { hook, calls } = setup({ keepData: true })
    act(() => void hook.result.current.start('a'))
    await act(async () => calls[0].resolve('A'))
    act(() => void hook.result.current.start('b'))
    expect(hook.result.current).toMatchObject({ status: 'running', data: 'A' })
    await act(async () => calls[1].reject(new Error('x')))
    expect(hook.result.current).toMatchObject({ status: 'error', data: 'A' })
  })

  it('setData: shows partial data while running, but not from a stale request', async () => {
    const { hook, calls } = setup()
    act(() => void hook.result.current.start('a'))
    act(() => calls[0].setData('half'))
    expect(hook.result.current).toMatchObject({ status: 'running', data: 'half' })
    act(() => void hook.result.current.start('b'))
    act(() => calls[0].setData('late'))
    expect(hook.result.current.data).toBeUndefined()
  })

  it('cancel: aborts, returns to idle, and ignores the late answer', async () => {
    const { hook, calls } = setup()
    let outcome: unknown
    act(() => {
      void hook.result.current.start('a').then((o) => (outcome = o))
    })
    act(() => hook.result.current.cancel())
    expect(calls[0].signal.aborted).toBe(true)
    expect(hook.result.current.status).toBe('idle')
    await act(async () => calls[0].resolve('A'))
    expect(hook.result.current.status).toBe('idle')
    expect(outcome).toEqual({ kind: 'stale' })
  })

  it('cancel with keepData goes back to the previous result; cancel when not running does nothing', async () => {
    const { hook, calls } = setup({ keepData: true })
    act(() => void hook.result.current.start('a'))
    await act(async () => calls[0].resolve('A'))
    const doneId = hook.result.current.id
    act(() => hook.result.current.cancel())
    expect(hook.result.current).toMatchObject({ status: 'done', data: 'A', id: doneId })
    act(() => void hook.result.current.start('b'))
    act(() => hook.result.current.cancel())
    expect(hook.result.current).toMatchObject({ status: 'done', data: 'A', id: doneId })
  })

  it('reset: drops a result, and stops a running request', async () => {
    const { hook, calls } = setup()
    act(() => void hook.result.current.start('a'))
    await act(async () => calls[0].resolve('A'))
    act(() => hook.result.current.reset())
    expect(hook.result.current).toMatchObject({ status: 'idle', data: undefined })
    act(() => void hook.result.current.start('b'))
    act(() => hook.result.current.reset())
    expect(calls[1].signal.aborted).toBe(true)
    expect(hook.result.current.status).toBe('idle')
  })

  it('update: changes the data of the current done result only', async () => {
    const { hook, calls } = setup()
    act(() => void hook.result.current.start('a'))
    await act(async () => calls[0].resolve('A'))
    const id = hook.result.current.id!
    act(() => hook.result.current.update(id, (d) => `${d}+`))
    expect(hook.result.current.data).toBe('A+')
    act(() => hook.result.current.update(id + 100, (d) => `${d}!`))
    act(() => void hook.result.current.start('b'))
    act(() => hook.result.current.update(id, (d) => `${d}?`))
    expect(hook.result.current).toMatchObject({ status: 'running', data: undefined })
  })

  it('resetKey: a new key shows idle at once, aborts the request, and drops its answer', async () => {
    const { hook, calls } = setup({ resetKey: 'org1', keepData: true })
    act(() => void hook.result.current.start('a'))
    await act(async () => calls[0].resolve('A'))
    act(() => void hook.result.current.start('b'))
    hook.rerender({ resetKey: 'org2' })
    expect(hook.result.current).toMatchObject({ status: 'idle', data: undefined })
    expect(calls[1].signal.aborted).toBe(true)
    await act(async () => calls[1].resolve('B'))
    expect(hook.result.current.status).toBe('idle')
  })

  it('auto: starts on mount and again when the key changes', async () => {
    const { hook, calls } = setup({ resetKey: 'org1', auto: 'x' })
    expect(calls.map((c) => c.args)).toEqual(['x'])
    hook.rerender({ resetKey: 'org2', auto: 'x' })
    expect(calls).toHaveLength(2)
    expect(calls[0].signal.aborted).toBe(true)
    await act(async () => calls[1].resolve('X2'))
    expect(hook.result.current.data).toBe('X2')
  })

  it('StrictMode: the remount aborts the first auto request and starts again', async () => {
    const { hook, calls } = setup({ auto: 'x' }, true)
    expect(calls).toHaveLength(2)
    expect(calls[0].signal.aborted).toBe(true)
    await act(async () => calls[0].resolve('old'))
    await act(async () => calls[1].resolve('new'))
    expect(hook.result.current.data).toBe('new')
  })

  it('unmount: aborts, and a start afterwards is stale', async () => {
    const { hook, calls } = setup()
    const start = hook.result.current.start
    act(() => void start('a'))
    hook.unmount()
    expect(calls[0].signal.aborted).toBe(true)
    await expect(start('b')).resolves.toEqual({ kind: 'stale' })
  })
})
