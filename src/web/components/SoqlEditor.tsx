// The SOQL editor (CodeMirror 6), embedded without a React wrapper.
// See docs/web.md ("補完", "日本語入力").
import { autocompletion, startCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { sql, SQLDialect } from '@codemirror/lang-sql'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { t } from '../i18n/i18n.ts'
import { contextCandidates, keywordCandidates, type Candidate, type Describer } from '../soql/completion.ts'
import { cursorInfo } from '../soql/context.ts'
import { useOrgs } from '../state/OrgContext.tsx'
import { describeGlobal, describeSObject } from '../state/describeCache.ts'
import { saveEditorText, savedEditorText } from '../state/editorStorage.ts'
import { useSoql } from '../state/SoqlContext.tsx'
import styles from './SoqlEditor.module.css'

const SOQL = SQLDialect.define({
  keywords:
    'select from where and or not in like includes excludes null true false order by asc desc nulls first last group having limit offset for view reference update with security_enforced user_mode system_mode using scope typeof when then else end rollup cube',
  builtin:
    'count count_distinct sum avg min max fields all standard custom today yesterday tomorrow last_week this_week next_week last_month this_month next_month last_90_days next_90_days this_quarter last_quarter next_quarter this_year last_year next_year',
})

/** Syntax colors from tokens.css, so that they follow dark mode. */
const soqlHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--color-syntax-keyword)', fontWeight: '600' },
  { tag: [tags.standard(tags.name), tags.function(tags.variableName)], color: 'var(--color-syntax-builtin)' },
  { tag: tags.string, color: 'var(--color-syntax-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--color-syntax-literal)' },
  { tag: tags.comment, color: 'var(--color-muted)' },
])

const editorTheme = EditorView.theme({
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--color-selection) !important',
  },
  '.cm-cursor': { borderLeftColor: 'var(--color-ink)' },
})

const SETTLE_MS = 300
/** Safari can deliver the Enter that commits IME conversion after compositionend. */
const COMPOSITION_ENTER_MS = 100
/** After a describe fails, completion does not ask for it again for this long (it runs on every key). */
const RETRY_AFTER_MS = 30_000

/** The icon CodeMirror shows next to each candidate. */
const OPTION_TYPE: Record<Candidate['kind'], string> = {
  object: 'class',
  relationship: 'type',
  field: 'property',
  keyword: 'keyword',
}

export function SoqlEditor() {
  const host = useRef<HTMLDivElement>(null)
  const soql = useSoql()
  const { selected } = useOrgs()
  // CodeMirror is created once; it reads the latest values through these refs.
  const latest = useRef({ soql, selected })
  useEffect(() => {
    latest.current = { soql, selected }
  })

  useEffect(() => {
    if (!host.current) return
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    let compositionEndedAt = 0
    /** When each describe (per org, API and object) last failed. */
    const failedAt = new Map<string, number>()
    const guarded = async <T,>(key: string, load: () => Promise<T>): Promise<T> => {
      if (Date.now() - (failedAt.get(key) ?? 0) < RETRY_AFTER_MS) throw new Error('failed recently')
      try {
        return await load()
      } catch (e) {
        failedAt.set(key, Date.now())
        throw e
      }
    }

    const completionSource = async (context: CompletionContext): Promise<CompletionResult | null> => {
      const info = cursorInfo(context.state.doc.toString(), context.pos)
      if (info.context.kind === 'none') return null
      // Open while typing a word or right after a dot (`Account.`), or on Ctrl+Space.
      if (!info.word && !info.afterDot && !context.explicit) return null
      const { soql: s, selected: username } = latest.current
      // Without describes: keywords, except after a dot where only fields fit.
      let candidates = info.dotted ? [] : keywordCandidates(info.word)
      if (username) {
        const prefix = `${username}\n${s.tooling}\n`
        const describer: Describer = {
          objects: async () => (await guarded(prefix, () => describeGlobal(username, s.tooling))).sobjects,
          describe: (name) => guarded(prefix + name.toLowerCase(), () => describeSObject(username, name, s.tooling)),
        }
        try {
          candidates = await contextCandidates(info, describer, s.names)
        } catch {
          // The fallback above, without a notification: completion runs on every key.
        }
      }
      if (candidates.length === 0) return null
      const options = candidates.map((c) => ({ label: c.label, apply: c.insert, type: OPTION_TYPE[c.kind] }))
      return { from: info.from, options, filter: false }
    }

    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: savedEditorText(),
        extensions: [
          history(),
          sql({ dialect: SOQL }),
          syntaxHighlighting(soqlHighlight),
          editorTheme,
          placeholder(t.editorPlaceholder),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': t.editorLabel }),
          // Before autocompletion, so that it runs before the completion's Enter.
          Prec.highest(
            EditorView.domEventHandlers({
              keydown: (e) => {
                if (e.key !== 'Enter') return false
                // The Enter that commits IME conversion must not also accept a
                // completion. Safari can deliver it just after compositionend.
                return e.isComposing || e.keyCode === 229 || Date.now() - compositionEndedAt < COMPOSITION_ENTER_MS
              },
            }),
          ),
          autocompletion({ override: [completionSource], activateOnTyping: true }),
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-Enter',
                run: () => {
                  latest.current.soql.run()
                  return true
                },
              },
            ]),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.domEventHandlers({
            compositionend: (_e, v) => {
              compositionEndedAt = Date.now()
              // Search by Japanese labels: open completion once conversion is committed.
              setTimeout(() => startCompletion(v), 0)
              return false
            },
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            const text = update.state.doc.toString()
            saveEditorText(text)
            clearTimeout(settleTimer)
            settleTimer = setTimeout(() => latest.current.soql.onTextSettled(text), SETTLE_MS)
          }),
        ],
      }),
    })

    latest.current.soql.registerEditor({
      getText: () => view.state.doc.toString(),
      setText: (text) => {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
        saveEditorText(text)
      },
      focus: () => view.focus(),
    })

    return () => {
      clearTimeout(settleTimer)
      latest.current.soql.registerEditor(null)
      view.destroy()
    }
  }, [])

  return <div ref={host} className={styles.editor} />
}
