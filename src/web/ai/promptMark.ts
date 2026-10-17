// Which request to the AI a run records in the history (docs/ai.md
// "最近のクエリへの記録", "画面の状態と遷移"). Decided here only.
import { squashSoql } from '../../shared/api.ts'
import { formatSoql } from '../soql/selection.ts'

/** The query an AI proposal or a history entry put in the editor, with the request behind it. */
export type PromptMark = { soql: string; tooling: boolean; prompt: string }

/**
 * The query as compared: formatted when it parses, so that Format (which also
 * changes case and the spaces around symbols) keeps the request; with only
 * spaces squashed when it does not.
 */
function comparable(soql: string): string {
  return squashSoql(formatSoql(soql) ?? soql)
}

/** The mark for a query put in the editor: none without a request, so that an old one does not stay. */
export function markFor(soql: string, tooling: boolean, prompt: string | undefined): PromptMark | undefined {
  return prompt ? { soql: comparable(soql), tooling, prompt } : undefined
}

/** The request to record with this run: only while the query is still the marked one, apart from formatting. */
export function promptForRun(mark: PromptMark | undefined, soql: string, tooling: boolean): string | undefined {
  return mark && mark.tooling === tooling && mark.soql === comparable(soql) ? mark.prompt : undefined
}
