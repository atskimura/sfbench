// CodeMirror for JSON: the REST API request body and the response body
// (docs/rest.md "ボディの欄とレスポンスの表示"). Embedded without a React wrapper,
// as the SOQL editor is.
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useRef } from 'react'
import type { EditorHandle } from '../state/SoqlContext.tsx'
import styles from './CodeEditor.module.css'

/** Syntax colors from tokens.css, so that they follow dark mode. */
const jsonHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--color-syntax-keyword)' },
  { tag: tags.string, color: 'var(--color-syntax-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--color-syntax-literal)' },
])

const theme = EditorView.theme({
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--color-selection) !important',
  },
  '.cm-cursor': { borderLeftColor: 'var(--color-ink)' },
})

type EditorProps = {
  initialText: string
  label: string
  /** Read only while the method sends no body. */
  readOnly: boolean
  onChange: (text: string) => void
  onModEnter: () => void
  register: (handle: EditorHandle | null) => void
}

/** The request body. Its text lives in CodeMirror; `onChange` follows it. */
export function JsonEditor({ initialText, label, readOnly, onChange, onModEnter, register }: EditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const editable = useRef(new Compartment())
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
        doc: initialText,
        extensions: [
          history(),
          json(),
          syntaxHighlighting(jsonHighlight),
          theme,
          placeholder('{ }'),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': label }),
          editable.current.of([EditorView.editable.of(!readOnly), EditorState.readOnly.of(readOnly)]),
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
    view.current = v
    register({
      getText: () => v.state.doc.toString(),
      setText: (text) => v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } }),
      focus: () => v.focus(),
    })
    return () => {
      register(null)
      v.destroy()
      view.current = null
    }
    // Once: the text lives in CodeMirror from here on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure([EditorView.editable.of(!readOnly), EditorState.readOnly.of(readOnly)]),
    })
  }, [readOnly])

  return <div ref={host} className={styles.editor} />
}

/** A response body, read only, colored when it is JSON. */
export function JsonView({ text, isJson, label }: { text: string; isJson: boolean; label: string }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          ...(isJson ? [json(), syntaxHighlighting(jsonHighlight)] : []),
          theme,
          EditorView.lineWrapping,
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          EditorView.contentAttributes.of({ 'aria-label': label }),
        ],
      }),
    })
    return () => v.destroy()
  }, [text, isJson, label])
  return <div ref={host} className={styles.editor} />
}
