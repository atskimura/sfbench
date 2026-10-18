// CodeMirror for the Apex screen: the code editor and the debug log
// (docs/apex.md "画面の構成"). Embedded without a React wrapper, as the SOQL
// editor is.
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState, Prec, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, keymap, lineNumbers, placeholder, type DecorationSet } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useRef } from 'react'
import { apex } from '../apex/language.ts'
import type { Match } from '../apex/log.ts'
import { t } from '../i18n/i18n.ts'
import type { ApexEditorHandle } from '../state/ApexContext.tsx'
import styles from './CodeEditor.module.css'

/** Syntax colors from tokens.css, so that they follow dark mode. */
const apexHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--color-syntax-keyword)', fontWeight: '600' },
  { tag: [tags.typeName, tags.meta], color: 'var(--color-syntax-builtin)' },
  { tag: tags.string, color: 'var(--color-syntax-string)' },
  { tag: [tags.number, tags.atom], color: 'var(--color-syntax-literal)' },
  { tag: tags.comment, color: 'var(--color-muted)' },
])

const theme = EditorView.theme({
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--color-selection) !important',
  },
  '.cm-cursor': { borderLeftColor: 'var(--color-ink)' },
})

type EditorProps = {
  initialText: string
  onChange: (text: string) => void
  onModEnter: () => void
  register: (handle: ApexEditorHandle | null) => void
}

/** The code. Its text lives in CodeMirror; `onChange` follows it. */
export function ApexEditor({ initialText, onChange, onModEnter, register }: EditorProps) {
  const host = useRef<HTMLDivElement>(null)
  // CodeMirror is created once; it reads the latest callbacks through this ref.
  const latest = useRef({ onChange, onModEnter })
  useEffect(() => {
    latest.current = { onChange, onModEnter }
  })

  useEffect(() => {
    if (!host.current) return
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        // The first text, outside the undo history.
        doc: initialText,
        extensions: [
          history(),
          lineNumbers(),
          apex,
          syntaxHighlighting(apexHighlight),
          theme,
          placeholder(t.apexPlaceholder),
          EditorView.contentAttributes.of({ 'aria-label': t.apexEditorLabel }),
          // Cmd+Enter never runs Apex: it only says how to (docs/apex.md "利用者と決めたこと").
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-Enter',
                run: () => {
                  latest.current.onModEnter()
                  return true
                },
              },
            ]),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onChange(update.state.doc.toString())
          }),
        ],
      }),
    })
    register({
      getText: () => v.state.doc.toString(),
      // One undoable change: loading a history entry can be undone.
      setText: (text) => v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } }),
      focus: () => v.focus(),
      goTo: (line, column) => {
        const target = v.state.doc.line(Math.min(Math.max(line, 1), v.state.doc.lines))
        const at = Math.min(target.from + Math.max((column ?? 1) - 1, 0), target.to)
        v.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) })
        v.focus()
      },
    })
    return () => {
      register(null)
      v.destroy()
    }
    // Once: the text lives in CodeMirror from here on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={host} className={`${styles.editor} ${styles.lineNumbers}`} />
}

const setMarks = StateEffect.define<{ matches: readonly Match[]; current: number }>()
const matchMark = Decoration.mark({ class: 'cm-searchMatch' })
const currentMark = Decoration.mark({ class: 'cm-searchMatch-current' })

/** The search matches, marked; the current one apart. */
const marks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setMarks)) {
        const { matches, current } = effect.value
        return Decoration.set(matches.map((m, i) => (i === current ? currentMark : matchMark).range(m.from, m.to)))
      }
    }
    return value
  },
  provide: (field) => EditorView.decorations.from(field),
})

/** The debug log, read only, with the search matches marked and the current one scrolled to. */
export function LogView({ text, matches, current }: { text: string; matches: readonly Match[]; current: number }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!host.current) return
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          marks,
          theme,
          EditorView.lineWrapping,
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          EditorView.contentAttributes.of({ 'aria-label': t.apexLog }),
        ],
      }),
    })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
  }, [text])

  // After the view above: a new text makes a new view, then marks it.
  useEffect(() => {
    const v = view.current
    if (!v) return
    const target = matches[current]
    v.dispatch({
      effects: [setMarks.of({ matches, current }), ...(target ? [EditorView.scrollIntoView(target.from, { y: 'center' })] : [])],
    })
  }, [text, matches, current])

  return <div ref={host} className={styles.editor} />
}
