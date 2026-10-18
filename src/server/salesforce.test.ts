import { describe, expect, it } from 'vitest'
import { InvalidPathError, salesforcePath } from './salesforce.ts'

describe('salesforcePath', () => {
  const instance = 'https://acme.my.salesforce.com'

  it('accepts paths under /services/ on the instance', () => {
    expect(() => salesforcePath('/services/data/v62.0/query?q=SELECT+Id+FROM+Account', instance)).not.toThrow()
    expect(() => salesforcePath('/services/data/', instance)).not.toThrow()
  })

  it.each([
    ['another host', 'https://evil.example.com/services/data/'],
    ['a protocol-relative URL', '//evil.example.com/services/data/'],
    ['a path outside /services/', '/secur/frontdoor.jsp'],
    ['a traversal out of /services/', '/services/../secur/frontdoor.jsp'],
    ['the same host over http', 'http://acme.my.salesforce.com/services/data/'],
  ])('rejects %s', (_label, path) => {
    expect(() => salesforcePath(path, instance)).toThrow(InvalidPathError)
  })
})
