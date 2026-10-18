/** The sf CLI is not installed or not on PATH. */
export class SfNotFoundError extends Error {
  constructor() {
    super('The Salesforce CLI (sf) was not found. Install it from https://developer.salesforce.com/tools/salesforcecli')
    this.name = 'SfNotFoundError'
  }
}

/** An sf command failed. `sfName` is the `name` from sf's JSON error, when there was one. */
export class SfCliError extends Error {
  readonly sfName: string | undefined
  constructor(message: string, sfName?: string) {
    super(message)
    this.name = 'SfCliError'
    this.sfName = sfName
  }
}

/** An sf command did not finish in time and was stopped. */
export class SfTimeoutError extends SfCliError {
  constructor(message: string) {
    super(message)
    this.name = 'SfTimeoutError'
  }
}

/** The org's auth is no longer valid (for example, the refresh token expired). */
export class OrgAuthError extends Error {
  readonly username: string
  constructor(username: string, message: string) {
    super(message)
    this.name = 'OrgAuthError'
    this.username = username
  }
}

// sf reports an expired refresh token with a generic error name, so the
// message is the only reliable signal. See docs/design.md.
const AUTH_ERROR_PATTERNS = [/unable to refresh session/i, /expired access\/refresh token/i, /invalid_grant/i]

export function isAuthErrorMessage(message: string): boolean {
  return AUTH_ERROR_PATTERNS.some((p) => p.test(message))
}
