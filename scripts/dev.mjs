// npm run dev: runs `npm run dev:server` and `npm run dev:web` side by side,
// and stops both on Ctrl+C or when Vite (dev:web) ends. The commands
// themselves are defined only in package.json.
//
// The server runs under `node --watch`, which does not exit when the server
// fails (for example when port 17717 is taken); it prints the error and
// waits for a file change, so Vite keeps running in that case.
import { spawn } from 'node:child_process'

const npm = process.env.npm_execpath
if (!npm) {
  console.error('Run this with `npm run dev`.')
  process.exit(1)
}
const windows = process.platform === 'win32'
// npm_execpath is npm's JavaScript entry; other package managers may give a binary.
const [command, prefix] = /\.[cm]?js$/.test(npm) ? [process.execPath, [npm]] : [npm, []]

let stopping = false
const children = ['dev:server', 'dev:web'].map((script) => {
  // Own process group on POSIX, so that the whole tree under npm can be
  // stopped and Ctrl+C reaches only this script, which then stops both.
  const child = spawn(command, [...prefix, 'run', '--silent', script], { stdio: 'inherit', detached: !windows })
  child.on('error', (e) => {
    console.error(`Could not start ${script}: ${e.message}`)
    stopAll(1)
  })
  child.on('exit', (code, signal) => {
    if (stopping) return
    console.error(`${script} exited (${signal ?? `code ${code}`}); stopping the other.`)
    stopAll(code || 1)
  })
  return child
})

/** Stops each child with everything it started (npm, the shell, node or Vite). */
function stopTree(child) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
  if (windows) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // Already gone.
    }
  }
}

function stopAll(code) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  for (const child of children) stopTree(child)
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stopAll(0))
