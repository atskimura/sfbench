// The Node.js versions sfbench runs on, as package.json "engines" says:
// 22.21.0 or later in the 22 line, or 24.5.0 or later. Older ones lack
// --use-env-proxy, which the server is started with, and the server dies at
// once (docs/design.md "プロキシ").

/** Why this Node.js cannot run sfbench, with what to do; undefined when it can. */
export function unsupportedNode(version: string = process.versions.node, execPath: string = process.execPath): string | undefined {
  const [major, minor] = version.split('.').map(Number)
  const supported = (major === 22 && minor >= 21) || (major === 24 && minor >= 5) || major > 24
  if (supported) return undefined
  return [
    `sfbench needs Node.js 22.21.0 or later in the 22 line, or 24.5.0 or later, but this is Node.js ${version} (${execPath}).`,
    'A version manager (asdf, nvm, mise and the like) may pick an older Node.js in this folder.',
    'To run sfbench with Node.js 24 from npm anyway:',
    '  npx -y -p node@24 -p sfbench -- sfbench <options>',
  ].join('\n')
}
