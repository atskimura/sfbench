// Whether this Node.js can run the sfbench server, which is started with
// --use-env-proxy (docs/design.md "プロキシ"). Node.js has it from 22.21.0 and
// 24.5.0 (package.json "engines"); an older one refuses the option and the
// server dies at once. The option itself is checked, not the version.

/** Why this Node.js cannot run sfbench, with what to do; undefined when it can. */
export function unsupportedNode(
  hasEnvProxy: boolean = process.allowedNodeEnvironmentFlags.has('--use-env-proxy'),
  version: string = process.versions.node,
  execPath: string = process.execPath,
): string | undefined {
  if (hasEnvProxy) return undefined
  return [
    `sfbench needs Node.js 22.21.0 or later in the 22 line, or 24.5.0 or later, but this is Node.js ${version} (${execPath}).`,
    'A version manager (asdf, nvm, mise and the like) may pick an older Node.js in this folder.',
    'To run sfbench with Node.js 24 from npm anyway:',
    '  npx -y -p node@24 -p sfbench -- sfbench <options>',
  ].join('\n')
}
