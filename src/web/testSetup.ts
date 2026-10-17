// Runs around every test file (vitest.config.ts setupFiles).
import { afterEach } from 'vitest'

// describes are cached per module for the whole session, as in a tab; a test
// starts as a new tab would. Imported here, not at the top, so that the cache
// module loads after the test file's vi.mock of the API client.
afterEach(async () => {
  const { clearDescribeCache } = await import('./state/describeCache.ts')
  clearDescribeCache()
})
