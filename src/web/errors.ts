// How the screen sorts an error from the API, and the words it shows for it
// (docs/web.md "エラーの扱い"). Decided here only: the contexts and the flows
// act on the kind, and do not compare codes themselves.
import { ApiRequestError } from './apiClient.ts'
import { t } from './i18n/i18n.ts'

export type ErrorKind =
  /** The request was stopped: nothing to show. */
  | 'aborted'
  /** sfbench's session is gone or the server stopped: the band under the header. */
  | 'sessionLost'
  /** The sf CLI is missing: shown instead of the workspace. */
  | 'sfNotFound'
  /** The org needs a new login: the org is marked and the relogin command shown. */
  | 'orgAuth'
  /** The org is no longer in the list: the list is loaded again and opened. */
  | 'orgNotFound'
  /** Salesforce refused the request as written (a 400): a fix to the request may help. */
  | 'rejected'
  /** Anything else, shown with its message. */
  | 'other'

export function errorKind(e: unknown): ErrorKind {
  if (!(e instanceof ApiRequestError)) return 'other'
  if (e.code === 'ABORTED') return 'aborted'
  if (e.isSessionLost) return 'sessionLost'
  switch (e.code) {
    case 'SF_CLI_NOT_FOUND':
      return 'sfNotFound'
    case 'ORG_AUTH_ERROR':
      return 'orgAuth'
    case 'ORG_NOT_FOUND':
      return 'orgNotFound'
    case 'SALESFORCE_ERROR':
      // Salesforce answers a query it cannot run (MALFORMED_QUERY, INVALID_FIELD...) with 400.
      // Other statuses (403 for API limits or access, 5xx for its own failures) are not fixed by changing the query.
      return e.body?.status === 400 ? 'rejected' : 'other'
    default:
      return 'other'
  }
}

/** Shown by the app or the org context, not where the error happened. */
export function isShownElsewhere(kind: ErrorKind): boolean {
  return kind !== 'rejected' && kind !== 'other'
}

/** The message to show. The server's words for its own conditions are replaced by the screen's. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiRequestError) {
    if (e.code === 'SALESFORCE_TIMEOUT') return t.salesforceTimeout
    if (e.code === 'SALESFORCE_UNREACHABLE') return t.salesforceUnreachable
    if (e.code === 'ORG_AUTH_ERROR') return t.orgAuthError
    return e.message
  }
  return e instanceof Error ? e.message : String(e)
}

/** The raw details the server sent with the error (such as Salesforce's error JSON), shown on demand. */
export function errorDetails(e: unknown): unknown {
  return e instanceof ApiRequestError ? e.body?.details : undefined
}

/** The relogin command sent with an org's login error. */
export function reloginCommand(e: unknown): string | undefined {
  return e instanceof ApiRequestError ? e.body?.reloginCommand : undefined
}

/** The query locator behind a next page expired or was dropped: the same request can never succeed. */
export function isLocatorGone(e: unknown): boolean {
  return errorKind(e) === 'rejected' && JSON.stringify(errorDetails(e) ?? '').includes('INVALID_QUERY_LOCATOR')
}

/**
 * What a failed run (a query now; later a REST request or Apex) shows in the
 * result area, or undefined when another place shows it.
 */
export function runFailure(
  e: unknown,
): { message: string; details?: unknown; reloginCommand?: string; orgAuth: boolean; rejected: boolean } | undefined {
  const kind = errorKind(e)
  if (kind === 'orgAuth') return { message: t.orgAuthError, reloginCommand: reloginCommand(e), orgAuth: true, rejected: false }
  if (isShownElsewhere(kind)) return undefined
  return { message: errorMessage(e), details: errorDetails(e), orgAuth: false, rejected: kind === 'rejected' }
}
