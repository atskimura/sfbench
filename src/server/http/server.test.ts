import { describe, expect, it } from 'vitest'
import { cacheControl } from './server.ts'

describe('cacheControl', () => {
  it('caches only the hashed files under /assets/', () => {
    expect(cacheControl('/assets/index-abc123.js')).toContain('immutable')
    expect(cacheControl('/licenses.txt')).toBe('no-store')
    expect(cacheControl('/favicon.svg')).toBe('no-store')
    expect(cacheControl('/')).toBe('no-store')
  })
})
