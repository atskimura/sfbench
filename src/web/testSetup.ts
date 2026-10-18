// Runs around every test file (vitest.config.ts setupFiles).
import { configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// Tests that render the whole app wait for the org list, the query and the
// result before their first find; on a slow CI runner (Windows) that can pass
// the default 1 second. A real failure still fails, after 5 seconds.
configure({ asyncUtilTimeout: 5_000 })

// describes are cached per module for the whole session, as in a tab; a test
// starts as a new tab would. Imported here, not at the top, so that the cache
// module loads after the test file's vi.mock of the API client.
afterEach(async () => {
  const { clearDescribeCache } = await import('./state/describeCache.ts')
  clearDescribeCache()
})
