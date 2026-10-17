// Run by prepublishOnly: publish only from a clean main that matches origin,
// with the version tag on HEAD both here and on origin, so that the package
// can be traced to a commit (CLAUDE.md "公開の手順").
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tag = `v${version}`
const problems = []

/** Runs one check; a git failure (offline, no origin) becomes a problem, not a crash. */
function check(describe, test) {
  try {
    if (!test()) problems.push(describe)
  } catch (e) {
    problems.push(`${describe} (could not check: ${e.message.split('\n')[0]})`)
  }
}

check('Not on main.', () => git('rev-parse', '--abbrev-ref', 'HEAD') === 'main')
check('The working tree has changes or untracked files.', () => git('status', '--porcelain') === '')
check('main differs from origin/main.', () => {
  git('fetch', '--quiet', 'origin', 'main')
  return git('rev-parse', 'HEAD') === git('rev-parse', 'origin/main')
})
check(`HEAD has no tag ${tag}.`, () => git('tag', '--points-at', 'HEAD').split('\n').includes(tag))
check(`The tag ${tag} on origin does not point at HEAD (push it first).`, () => {
  const head = git('rev-parse', 'HEAD')
  // An annotated tag is listed twice; the line ending in ^{} holds the commit.
  const lines = git('ls-remote', '--tags', 'origin', tag, `${tag}^{}`).split('\n').filter(Boolean)
  return lines.some((line) => line.startsWith(head))
})

if (problems.length > 0) {
  console.error(`Not publishing:\n${problems.map((p) => `- ${p}`).join('\n')}`)
  process.exit(1)
}
