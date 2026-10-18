import { describe, expect, it } from 'vitest'
import { unsupportedNode } from './nodeVersion.ts'

describe('unsupportedNode', () => {
  it('takes the versions of package.json "engines"', () => {
    for (const v of ['22.21.0', '22.22.1', '24.5.0', '24.11.0', '25.0.0']) expect(unsupportedNode(v, '/n')).toBeUndefined()
  })

  it('says why an older one cannot run sfbench, and how to run it anyway', () => {
    for (const v of ['22.12.0', '22.20.9', '23.11.0', '24.4.1', '20.18.0']) expect(unsupportedNode(v, '/n')).toContain(`this is Node.js ${v} (/n)`)
    expect(unsupportedNode('22.12.0', '/n')).toContain('npx -y -p node@24 -p sfbench -- sfbench')
  })
})
