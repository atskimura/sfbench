// Runs the sf CLI as a child process. See docs/design.md ("sf CLI の呼び出し方").
//
// - sf is started by its absolute path, resolved from PATH without the current
//   directory, so that an untrusted `sf.cmd` in the working directory is never run.
// - Arguments are fixed strings only. The org goes in SF_TARGET_ORG and user
//   input goes in files, because on Windows `sf.cmd` needs a shell and the shell
//   would interpret symbols in the arguments.
// - At most MAX_CONCURRENT sf processes run at once; the rest wait in a queue.
import { execFile } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { SfCliError, SfNotFoundError } from './errors.ts'

const isWindows = process.platform === 'win32'
const MAX_CONCURRENT = 4
const DEFAULT_TIMEOUT_MS = 60_000
const MAX_OUTPUT_BYTES = 512 * 1024 * 1024

let sfPath: string | undefined

/** Finds sf on PATH. Relative PATH entries (including ".") are ignored. */
export function resolveSfPath(env: NodeJS.ProcessEnv = process.env): string {
  if (sfPath) return sfPath
  const names = isWindows ? ['sf.cmd', 'sf.exe', 'sf.bat'] : ['sf']
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter((d) => d && isAbsolute(d))
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name)
      try {
        accessSync(candidate, isWindows ? constants.F_OK : constants.X_OK)
        sfPath = candidate
        return candidate
      } catch {
        // Try the next one.
      }
    }
  }
  throw new SfNotFoundError()
}

let running = 0
const waiting: (() => void)[] = []

async function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running++
    return
  }
  await new Promise<void>((resolve) => waiting.push(resolve))
}

function release(): void {
  const next = waiting.shift()
  if (next) next()
  else running--
}

export type SfRunOptions = {
  /** Username of the target org, passed in SF_TARGET_ORG. */
  targetOrg?: string
  /** Working directory. The server always uses ~/.sfbench/tmp. */
  cwd: string
  timeoutMs?: number
}

export type SfRunResult = { stdout: string; stderr: string; exitCode: number }

/** Runs `sf <args>` and returns its output. Resolves even when sf exits with a non-zero code. */
export async function runSf(args: readonly string[], options: SfRunOptions): Promise<SfRunResult> {
  const file = resolveSfPath()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SF_JSON_TO_STDOUT: 'true',
    SF_DISABLE_AUTOUPDATE: 'true',
    SF_AUTOUPDATE_DISABLE: 'true',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  }
  delete env.SF_TARGET_ORG
  if (options.targetOrg) env.SF_TARGET_ORG = options.targetOrg
  if (isWindows) env.NoDefaultCurrentDirectoryInExePath = '1'

  await acquire()
  try {
    return await new Promise<SfRunResult>((resolve, reject) => {
      execFile(
        // With a shell, Node joins the command line without quoting, so quote the path.
        isWindows ? `"${file}"` : file,
        args,
        {
          cwd: options.cwd,
          env,
          shell: isWindows,
          windowsHide: true,
          timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          killSignal: 'SIGKILL',
          maxBuffer: MAX_OUTPUT_BYTES,
          encoding: 'utf8',
        },
        (error, stdout, stderr) => {
          if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(new SfNotFoundError())
            return
          }
          if (error && error.killed) {
            reject(new SfCliError(`sf ${args[0]} ${args[1] ?? ''} timed out`))
            return
          }
          const exitCode = typeof error?.code === 'number' ? error.code : error ? 1 : 0
          resolve({ stdout, stderr, exitCode })
        },
      )
    })
  } finally {
    release()
  }
}

type SfJson<T> = { status?: number; result?: T; name?: string; message?: string }

/** Runs an sf command with --json and returns `result`. Throws SfCliError when sf reports an error. */
export async function runSfJson<T>(args: readonly string[], options: SfRunOptions): Promise<T> {
  const { stdout, stderr, exitCode } = await runSf([...args, '--json'], options)
  let json: SfJson<T> | undefined
  try {
    json = JSON.parse(stdout) as SfJson<T>
  } catch {
    json = undefined
  }
  if (json && json.status === 0 && exitCode === 0 && json.result !== undefined) return json.result
  if (json?.message) throw new SfCliError(json.message, json.name)
  throw new SfCliError(lastErrorLine(stderr) ?? `sf ${args.join(' ')} failed with exit code ${exitCode}`)
}

/** Extracts the error message from sf's human-readable stderr ("Error (Name): message"). */
export function lastErrorLine(stderr: string): string | undefined {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim())
  const errorLine = lines.find((l) => /^Error \(.+?\): /.test(l))
  if (errorLine) return errorLine.replace(/^Error \(.+?\): /, '')
  const meaningful = lines.filter((l) => l && !l.startsWith('›'))
  return meaningful.at(-1)
}
