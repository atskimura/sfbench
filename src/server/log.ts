// Server log. The server writes it itself, opening and closing the file on
// every write so that the file can be rotated while the server runs (also on
// Windows). Never pass tokens, API keys, `sf org open` URLs, SOQL or request
// bodies to these functions.
import { appendFileSync, renameSync, statSync } from 'node:fs'

const MAX_BYTES = 1024 * 1024

let logFile: string | undefined
let alsoConsole = false

export function initLog(file: string, toConsole: boolean): void {
  logFile = file
  alsoConsole = toConsole
}

function write(level: string, message: string): void {
  const line = `${new Date().toISOString()} ${level} ${message}\n`
  if (alsoConsole) process.stderr.write(line)
  if (!logFile) return
  try {
    if ((statSync(logFile, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) {
      renameSync(logFile, `${logFile}.1`)
    }
    appendFileSync(logFile, line, { mode: 0o600 })
  } catch {
    // Logging must never break the server.
  }
}

export const log = {
  info: (message: string) => write('INFO', message),
  warn: (message: string) => write('WARN', message),
  error: (message: string) => write('ERROR', message),
}
