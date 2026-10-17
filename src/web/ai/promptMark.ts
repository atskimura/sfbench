// Which request to the AI a run records in the history (docs/ai.md
// "最近のクエリへの記録", "画面の状態と遷移"). Decided here only.
import { squashSoql } from '../../shared/api.ts'

/** The query an AI proposal or a history entry put in the editor, with the request behind it. */
export type PromptMark = { soql: string; tooling: boolean; prompt: string }

/** The mark for a query put in the editor: none without a request, so that an old one does not stay. */
export function markFor(soql: string, tooling: boolean, prompt: string | undefined): PromptMark | undefined {
  return prompt ? { soql: squashSoql(soql), tooling, prompt } : undefined
}

/** The request to record with this run: only while the query is still the marked one, apart from spaces. */
export function promptForRun(mark: PromptMark | undefined, soql: string, tooling: boolean): string | undefined {
  return mark && mark.tooling === tooling && mark.soql === squashSoql(soql) ? mark.prompt : undefined
}
