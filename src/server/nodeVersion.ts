// Whether this Node.js can run the sfbench server, which is started with
// --use-env-proxy (docs/design.md "プロキシ"). Node.js has it from 22.21.0 and
// 24.5.0 (package.json "engines"); an older one refuses the option and the
// server dies at once. The option itself is checked, not the version.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { packageRoot } from './paths.ts'

/** The versions package.json "engines" asks for, as the message names them. */
function engines(): string {
  try {
    return (JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { engines?: { node?: string } }).engines?.node ?? 'a newer one'
  } catch {
    return 'a newer one'
  }
}

/** Why this Node.js cannot run sfbench, with what to do; undefined when it can. */
export function unsupportedNode(
  hasEnvProxy: boolean = process.allowedNodeEnvironmentFlags.has('--use-env-proxy'),
  version: string = process.versions.node,
  execPath: string = process.execPath,
  wanted: string = engines(),
): string | undefined {
  if (hasEnvProxy) return undefined
  return [
    `sfbench needs Node.js ${wanted}, but this is Node.js ${version} (${execPath}).`,
    'A version manager (asdf, nvm, mise and the like) may pick an older Node.js in this folder.',
    'To run sfbench with Node.js 24 from npm anyway:',
    '  npx -y -p node@24 -p sfbench -- sfbench <options>',
  ].join('\n')
}
