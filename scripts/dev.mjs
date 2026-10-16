// npm run dev: runs `npm run dev:server` and `npm run dev:web` side by side,
// and stops both when either ends or on Ctrl+C. The commands themselves are
// defined only in package.json.
import { spawn } from 'node:child_process'

const npm = process.env.npm_execpath
if (!npm) {
  console.error('Run this with `npm run dev`.')
  process.exit(1)
}

const children = ['dev:server', 'dev:web'].map((script) => {
  const child = spawn(process.execPath, [npm, 'run', '--silent', script], { stdio: 'inherit' })
  child.on('error', (e) => {
    console.error(`Could not start ${script}: ${e.message}`)
    stopAll(1)
  })
  child.on('exit', (code) => {
    if (!stopping) console.error(`${script} exited${code ? ` with code ${code}` : ''}; stopping the other.`)
    stopAll(code ?? 0)
  })
  return child
})

let stopping = false
function stopAll(code) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  for (const child of children) if (child.exitCode === null) child.kill()
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stopAll(0))
