// Opens a URL in the default browser without a shell. See docs/design.md ("コマンドライン引数").
import { spawn } from 'node:child_process'
import { join } from 'node:path'

function command(url: string): [string, string[]] {
  switch (process.platform) {
    case 'darwin':
      return ['/usr/bin/open', [url]]
    case 'win32':
      // Absolute path, so that an executable in the working directory is never run.
      return [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'rundll32.exe'), ['url.dll,FileProtocolHandler', url]]
    default:
      return ['xdg-open', [url]]
  }
}

/** Resolves true when the browser command started, false when it could not be run. */
export function openBrowser(url: string): Promise<boolean> {
  const [file, args] = command(url)
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: 'ignore', detached: true, windowsHide: true })
    child.once('error', () => resolve(false))
    child.once('spawn', () => {
      child.unref()
      resolve(true)
    })
  })
}
