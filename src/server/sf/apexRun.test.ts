// docs/apex.md "実行の経路": sf apex run's output, read in a fixed order.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./run.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./run.ts')>()), runSf: vi.fn() }))

const { runSf } = await import('./run.ts')
const { parseApexOutput, runApex, ApexFileError, ApexRunError } = await import('./apexRun.ts')
const { OrgAuthError } = await import('./errors.ts')
const runMock = vi.mocked(runSf)
const fixture = (name: string) => readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf8')

describe('parseApexOutput', () => {
  it('reads a successful run with its debug log', () => {
    const out = parseApexOutput(fixture('apex-run-success.json'), '')
    expect(out).toMatchObject({ kind: 'ran', run: { result: 'success' } })
    expect(out.kind === 'ran' && out.run.logs).toContain('USER_DEBUG|[2]|DEBUG|rows 2')
    expect(out.kind === 'ran' && out.run.line).toBeUndefined()
  })

  it('reads a compile error with its position, from the strings sf writes', () => {
    expect(parseApexOutput(fixture('apex-run-compile.json'), '')).toEqual({
      kind: 'ran',
      run: { result: 'compileError', compileProblem: 'Illegal assignment from String to Integer', line: 1, column: 9, logs: '' },
    })
  })

  it('reads an exception with its stack trace and log', () => {
    const out = parseApexOutput(fixture('apex-run-runtime.json'), '')
    expect(out).toMatchObject({
      kind: 'ran',
      run: { result: 'runtimeError', exceptionMessage: 'System.MathException: Divide by 0', exceptionStackTrace: 'AnonymousBlock: line 1, column 1', line: 1, column: 1 },
    })
  })

  it('takes an exception mentioning invalid_grant for a run, not for a lost login', () => {
    const json = JSON.parse(fixture('apex-run-runtime.json'))
    json.message = 'Execution failed: System.CalloutException: invalid_grant'
    json.data.exceptionMessage = 'System.CalloutException: invalid_grant'
    expect(parseApexOutput(JSON.stringify(json), '').kind).toBe('ran')
  })

  it('takes a run failure without its data for unknown, even when it mentions invalid_grant', () => {
    expect(parseApexOutput(JSON.stringify({ status: 1, name: 'executeRuntimeFailure', message: 'System.CalloutException: invalid_grant' }), '')).toMatchObject({
      kind: 'failed',
      sfName: 'executeRuntimeFailure',
    })
  })

  it('takes a run without a compile flag for a run, never for a compile error', () => {
    expect(parseApexOutput(JSON.stringify({ status: 0, result: { success: true, logs: '' } }), '')).toMatchObject({ kind: 'ran', run: { result: 'success' } })
    expect(parseApexOutput(JSON.stringify({ status: 0, result: { logs: '' } }), '')).toMatchObject({ kind: 'ran', run: { result: 'runtimeError' } })
  })

  it('takes a login error before running for a lost login, and anything else for unknown', () => {
    expect(parseApexOutput(JSON.stringify({ status: 1, name: 'Error', message: 'Unable to refresh session due to: expired access/refresh token' }), '')).toMatchObject({ kind: 'authError' })
    expect(parseApexOutput(JSON.stringify({ status: 1, name: 'unexpectedExecuteCommandError', message: 'socket hang up' }), '')).toEqual({
      kind: 'failed',
      sfName: 'unexpectedExecuteCommandError',
      message: 'socket hang up',
    })
    expect(parseApexOutput('not json', 'Error (X): something broke')).toEqual({ kind: 'failed', sfName: 'unreadable', message: 'something broke' })
  })
})

describe('runApex', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sfbench-apex-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetAllMocks()
  })

  it('gives sf the code in a file, never on the command line, and removes the file', async () => {
    let written = ''
    runMock.mockImplementation(async (args, options) => {
      written = readFileSync(join(dir, args[3]), 'utf8')
      expect(args).toEqual(['apex', 'run', '-f', expect.stringMatching(/^apex-[0-9a-f]+\.apex$/), '--json'])
      expect(options).toMatchObject({ targetOrg: 'u@example.com', cwd: dir, timeoutMs: 1000 })
      return { stdout: fixture('apex-run-success.json'), stderr: '', exitCode: 0 }
    })
    expect((await runApex('u@example.com', "System.debug('x');", dir, 1000)).result).toBe('success')
    expect(written).toBe("System.debug('x');")
    expect(readdirSync(dir)).toEqual([])
  })

  it('gives sf a chosen API version', async () => {
    runMock.mockResolvedValueOnce({ stdout: fixture('apex-run-success.json'), stderr: '', exitCode: 0 })
    await runApex('u@example.com', 'x', dir, 1000, '55.0')
    expect(runMock.mock.calls[0][0]).toEqual(['apex', 'run', '-f', expect.stringMatching(/^apex-[0-9a-f]+\.apex$/), '--api-version', '55.0', '--json'])
  })

  it('throws a lost login and an unknown failure apart', async () => {
    runMock.mockResolvedValueOnce({ stdout: JSON.stringify({ status: 1, message: 'invalid_grant: expired access/refresh token' }), stderr: '', exitCode: 1 })
    await expect(runApex('u@example.com', 'x', dir, 1000)).rejects.toBeInstanceOf(OrgAuthError)
    runMock.mockResolvedValueOnce({ stdout: JSON.stringify({ status: 1, name: 'unexpectedExecuteCommandError', message: 'boom' }), stderr: '', exitCode: 1 })
    await expect(runApex('u@example.com', 'x', dir, 1000)).rejects.toBeInstanceOf(ApexRunError)
  })

  it('does not start sf when the code cannot be written', async () => {
    await expect(runApex('u@example.com', 'x', join(dir, 'missing'), 1000)).rejects.toBeInstanceOf(ApexFileError)
    expect(runMock).not.toHaveBeenCalled()
  })
})
