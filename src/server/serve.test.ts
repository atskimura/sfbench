import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isStderrFile } from './serve.ts'

describe('isStderrFile', () => {
  const tmp = join('home', '.sfbench', 'tmp')

  it('takes only a stderr file the CLI made, in tmp/', () => {
    expect(isStderrFile(join(tmp, 'server-stderr-1792346819943-46053.log'), tmp)).toBe(true)
    expect(isStderrFile(join(tmp, 'apex-1234.apex'), tmp)).toBe(false)
    expect(isStderrFile(join('home', 'server-stderr-1-2.log'), tmp)).toBe(false)
    expect(isStderrFile(join(tmp, '..', 'settings.json'), tmp)).toBe(false)
  })
})
