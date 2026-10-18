// `sf apex run`: runs anonymous Apex and returns the result with its debug
// log (docs/apex.md "実行の経路"). One of the documented exceptions to "depend
// only on sf's JSON output" being stable: sf reports compile errors and
// exceptions as failures whose `data` holds the result as strings. All of that
// reading lives here, tested against recorded output in __fixtures__.
import { randomBytes } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ApexResult } from '../../shared/api.ts'
import { OrgAuthError, isAuthErrorMessage } from './errors.ts'
import { lastErrorLine, redactUrls, runSf } from './run.ts'

export type ApexRun = {
  result: ApexResult
  compileProblem?: string
  line?: number
  column?: number
  exceptionMessage?: string
  exceptionStackTrace?: string
  logs: string
}

/**
 * sf failed before or while running, and it cannot be told whether the code
 * ran. `sfName` is sf's error name. The message is for the screen only: it is
 * never logged (docs/apex.md "実行の経路").
 */
export class ApexRunError extends Error {
  readonly sfName: string
  constructor(sfName: string, message: string) {
    super(message)
    this.name = 'ApexRunError'
    this.sfName = sfName
  }
}

/** The code could not be written to its file: sf was not started, so nothing ran. */
export class ApexFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApexFileError'
  }
}

/** What sf's output says, in the order of docs/apex.md "実行の経路". Never reorder these checks. */
export type ApexOutput =
  | { kind: 'ran'; run: ApexRun }
  /** Refused before running: the org's login is no longer valid. */
  | { kind: 'authError'; message: string }
  /** Anything else: whether it ran is not known. */
  | { kind: 'failed'; sfName: string; message: string }

type SfApexJson = {
  status?: number
  name?: string
  message?: string
  result?: Record<string, unknown>
  data?: Record<string, unknown>
}

export function parseApexOutput(stdout: string, stderr: string): ApexOutput {
  let json: SfApexJson | undefined
  try {
    json = JSON.parse(stdout) as SfApexJson
  } catch {
    json = undefined
  }
  // 1. Ran.
  if (json?.status === 0 && json.result) return { kind: 'ran', run: toRun(json.result) }
  // 2. Ran, or reached Salesforce and did not compile. Before 3: an exception's
  // text can hold "invalid_grant" (a failed OAuth callout in the Apex itself).
  // Decided by the name alone: without `data`, it may have run, so it is unknown, never a login error.
  const message = redactUrls(json?.message ?? lastErrorLine(stderr) ?? 'sf apex run failed')
  if (json?.name === 'executeCompileFailure' || json?.name === 'executeRuntimeFailure') {
    return json.data ? { kind: 'ran', run: toRun(json.data) } : { kind: 'failed', sfName: json.name, message }
  }
  // 3. Only now: a login error, before anything ran.
  if (isAuthErrorMessage(message)) return { kind: 'authError', message }
  // 4. The rest is of unknown outcome.
  return { kind: 'failed', sfName: json?.name ?? 'unreadable', message }
}

/** sf writes true or 'True', 1 or '1', and -1 for no position. */
function toRun(r: Record<string, unknown>): ApexRun {
  const yes = (v: unknown) => v === true || v === 'True' || v === 'true'
  const no = (v: unknown) => v === false || v === 'False' || v === 'false'
  const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  const position = (v: unknown) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN
    return Number.isInteger(n) && n > 0 ? n : undefined
  }
  // Only a stated compile failure says it did not run: anything else may have run.
  const result: ApexResult = no(r.compiled) ? 'compileError' : yes(r.success) ? 'success' : 'runtimeError'
  const run: ApexRun = { result, logs: typeof r.logs === 'string' ? r.logs : '' }
  if (result !== 'success') {
    const line = position(r.line)
    const column = position(r.column)
    if (line !== undefined) run.line = line
    if (column !== undefined) run.column = column
  }
  if (result === 'compileError') run.compileProblem = text(r.compileProblem)
  if (result === 'runtimeError') {
    run.exceptionMessage = text(r.exceptionMessage)
    run.exceptionStackTrace = text(r.exceptionStackTrace)
  }
  return run
}

/**
 * Runs anonymous Apex in the org. The code goes in a file so that it never
 * appears on the command line. Throws OrgAuthError (did not run), SfTimeoutError
 * (sf was stopped; Salesforce may still run it), ApexFileError (did not run)
 * or ApexRunError (unknown).
 */
export async function runApex(username: string, code: string, tmpDir: string, timeoutMs: number): Promise<ApexRun> {
  const fileName = `apex-${randomBytes(8).toString('hex')}.apex`
  const filePath = join(tmpDir, fileName)
  try {
    try {
      writeFileSync(filePath, code, { mode: 0o600 })
    } catch (e) {
      throw new ApexFileError((e as Error).message)
    }
    // An SfTimeoutError from runSf goes to the caller as it is.
    const { stdout, stderr } = await runSf(['apex', 'run', '-f', fileName, '--json'], { targetOrg: username, cwd: tmpDir, timeoutMs })
    const output = parseApexOutput(stdout, stderr)
    if (output.kind === 'ran') return output.run
    if (output.kind === 'authError') throw new OrgAuthError(username, output.message)
    throw new ApexRunError(output.sfName, output.message)
  } finally {
    rmSync(filePath, { force: true })
  }
}
