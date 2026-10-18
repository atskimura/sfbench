// The API version chosen on the SOQL and Apex screens (docs/web.md "API バージョン").
// As the editor text, it survives a tab reload in the same org and nothing
// else: another org, or a new launch, starts at the latest.
import { claimEditorText, saveEditorText } from './editorStorage.ts'

const KEYS = { soql: 'sfbench.soqlApiVersion', apex: 'sfbench.apexApiVersion' } as const
export type VersionScreen = keyof typeof KEYS

/** Makes the storage the screen's of `org`, which is being made; undefined is the latest. */
export function claimApiVersion(org: string, screen: VersionScreen): string | undefined {
  return claimEditorText(org, undefined, KEYS[screen]) || undefined
}

export function saveApiVersion(org: string, screen: VersionScreen, version: string | undefined): void {
  saveEditorText(org, version ?? '', KEYS[screen])
}
