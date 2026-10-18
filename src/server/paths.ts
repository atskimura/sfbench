// Locations of sfbench's state. See docs/design.md ("データの保存").
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Root of the installed package (or of the repository during development). */
export const packageRoot = resolve(here, '..', '..')

/** Built web UI. Present only after `npm run build`. */
export const webRoot = join(packageRoot, 'dist', 'web')

export type Paths = {
  home: string
  serverJson: string
  serverLock: string
  serverLog: string
  settings: string
  historyDir: string
  /** The REST API screen's history, one file per org (docs/rest.md "実行履歴"). */
  restHistoryDir: string
  /** The Apex screen's history, one file per org (docs/apex.md "実行履歴"). */
  apexHistoryDir: string
  tmpDir: string
}

/**
 * State lives in ~/.sfbench, or in SFBENCH_HOME. `npm run dev:server` uses
 * .sfbench-dev in the repository so that it never touches the sfbench the
 * developer uses day to day.
 */
export function resolvePaths(dev: boolean): Paths {
  const home =
    process.env.SFBENCH_HOME ?? (dev ? join(packageRoot, '.sfbench-dev') : join(homedir(), '.sfbench'))
  return {
    home,
    serverJson: join(home, 'server.json'),
    serverLock: join(home, 'server.lock'),
    serverLog: join(home, 'server.log'),
    settings: join(home, 'settings.json'),
    historyDir: join(home, 'history'),
    restHistoryDir: join(home, 'rest-history'),
    apexHistoryDir: join(home, 'apex-history'),
    tmpDir: join(home, 'tmp'),
  }
}

/** Creates the state directories, readable only by the user (no effect on Windows). */
export function ensureDirs(paths: Paths): void {
  for (const dir of [paths.home, paths.historyDir, paths.restHistoryDir, paths.apexHistoryDir, paths.tmpDir]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
}
