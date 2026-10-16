// The SOQL editor (CodeMirror 6), embedded without a React wrapper.
// See docs/web.md ("補完", "日本語入力").
import { autocompletion, startCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { sql, SQLDialect } from '@codemirror/lang-sql'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { t } from '../i18n/i18n.ts'
import { fieldCandidates, fromObjectOf, keywordCandidates } from '../soql/completion.ts'
import { useOrgs } from '../state/OrgContext.tsx'
import { describeSObject } from '../state/describeCache.ts'
import { saveEditorText, savedEditorText } from '../state/editorStorage.ts'
import { useSoql } from '../state/SoqlContext.tsx'
import styles from './SoqlEditor.module.css'

const SOQL = SQLDialect.define({
  keywords:
    'select from where and or not in like includes excludes null true false order by asc desc nulls first last group having limit offset for view reference update with security_enforced user_mode system_mode using scope typeof when then else end rollup cube',
  builtin:
    'count count_distinct sum avg min max fields all standard custom today yesterday tomorrow last_week this_week next_week last_month this_month next_month last_90_days next_90_days this_quarter last_quarter next_quarter this_year last_year next_year',
})

const SETTLE_MS = 300
/** Safari can deliver the Enter that commits IME conversion after compositionend. */
const COMPOSITION_ENTER_MS = 100

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

    const completionSource = async (context: CompletionContext): Promise<CompletionResult | null> => {
      const word = context.matchBefore(/[\p{L}\p{N}_]+/u)
      if (!word && !context.explicit) return null
      const from = word ? word.from : context.pos
      const text = word ? word.text : ''
      // Parent paths such as Account.Na come with context-aware completion (PR 2c).
      if (context.state.sliceDoc(from - 1, from) === '.') return null
      const { soql: s, selected: username } = latest.current
      const options = keywordCandidates(text).map((c) => ({ label: c.label, apply: c.insert, type: 'keyword' }))
      const object = fromObjectOf(context.state.doc.toString())
      if (object && username) {
        try {
          const describe = await describeSObject(username, object, s.tooling)
          const fields = fieldCandidates(describe.fields, text, s.names).map((c) => ({
            label: c.label,
            apply: c.insert,
            type: 'property',
          }))
          options.unshift(...fields)
        } catch {
          // Unknown object or offline: keywords only.
        }
      }
      return options.length ? { from, options, filter: false } : null
    }

    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: savedEditorText(),
        extensions: [
          history(),
          sql({ dialect: SOQL }),
          syntaxHighlighting(defaultHighlightStyle),
          placeholder(t.editorPlaceholder),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': t.editorLabel }),
          autocompletion({ override: [completionSource], activateOnTyping: true }),
          Prec.highest(
            keymap.of([
              {
                key: 'Enter',
                // Swallow the Enter that commits IME conversion, so that it
                // does not also accept the first completion.
                run: () => Date.now() - compositionEndedAt < COMPOSITION_ENTER_MS,
              },
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
            keydown: (e) => e.keyCode === 229,
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
