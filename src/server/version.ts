import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { packageRoot } from './paths.ts'

let cached: string | undefined

export function packageVersion(): string {
  cached ??= (JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string }).version
  return cached
}
