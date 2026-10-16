// English and Japanese UI text, chosen by the browser language (docs/web.md "表示言語").
import { en, type Messages } from './en.ts'
import { ja } from './ja.ts'

export type { Messages }

export function pickMessages(language: string | undefined): Messages {
  return language?.toLowerCase().startsWith('ja') ? ja : en
}

export const t: Messages = pickMessages(typeof navigator === 'undefined' ? undefined : navigator.language)
