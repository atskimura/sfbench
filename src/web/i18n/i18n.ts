// English and Japanese UI text, chosen by the browser language (docs/web.md "表示言語").
import { en, type Messages } from './en.ts'
import { ja } from './ja.ts'

export type { Messages }

export function pickMessages(language: string | undefined): Messages {
  return language?.toLowerCase().startsWith('ja') ? ja : en
}

const browserLanguage = typeof navigator === 'undefined' ? undefined : navigator.language

export const t: Messages = pickMessages(browserLanguage)

/** The UI language, also given to the AI for its explanations; follows the messages chosen above. */
export const uiLanguage: 'en' | 'ja' = t === ja ? 'ja' : 'en'
