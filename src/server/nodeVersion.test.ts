import { describe, expect, it } from 'vitest'
import { unsupportedNode } from './nodeVersion.ts'

describe('unsupportedNode', () => {
  it('takes a Node.js that has --use-env-proxy', () => {
    expect(unsupportedNode(true, '24.11.0', '/n')).toBeUndefined()
  })

  it('says why one without it cannot run sfbench, and how to run it anyway', () => {
    const message = unsupportedNode(false, '22.12.0', '/n')
    expect(message).toContain('this is Node.js 22.12.0 (/n)')
    // The versions come from package.json "engines", the one place they are written.
    expect(message).toContain('needs Node.js ^22.21.0 || >=24.5.0')
    expect(message).toContain('npx -y -p node@24 -p sfbench -- sfbench')
  })

  it('is right about the Node.js running the tests, which is a supported one', () => {
    expect(unsupportedNode()).toBeUndefined()
  })
})
