// Run by prepublishOnly: publish only from a clean main that matches origin,
// with the version tag on HEAD, so that the package can be traced to a commit
// (CLAUDE.md "公開の手順").
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const problems = []

if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') problems.push('Not on main.')
if (git('status', '--porcelain') !== '') problems.push('The working tree has changes or untracked files.')
git('fetch', '--quiet', 'origin', 'main')
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) problems.push('main differs from origin/main.')
if (!git('tag', '--points-at', 'HEAD').split('\n').includes(`v${version}`)) problems.push(`HEAD has no tag v${version}.`)

if (problems.length > 0) {
  console.error(`Not publishing:\n${problems.map((p) => `- ${p}`).join('\n')}`)
  process.exit(1)
}
