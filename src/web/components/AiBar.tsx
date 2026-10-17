// The AI input above the editor, and the proposal card below it
// (docs/screens.md "AI の入力欄", "AI の提案カード"; docs/ai.md "画面").
import type { KeyboardEvent } from 'react'
import { diffWords } from '../ai/diff.ts'
import { t } from '../i18n/i18n.ts'
import { useApp } from '../state/AppContext.tsx'
import { useAi } from '../state/AiContext.tsx'
import { useOrgs } from '../state/OrgContext.tsx'
import styles from './AiBar.module.css'
import panel from './Panel.module.css'

export function AiBar() {
  const ai = useAi()
  const { setSettingsOpen } = useApp()
  const { selected } = useOrgs()
  if (ai.availability === 'hidden') return null
  if (ai.availability === 'setup') {
    return (
      <div className={styles.bar} data-ai-bar>
        <div className={styles.setup}>
          <span>{t.aiOff}</span>
          <span className={panel.meta}>{t.aiSetUpNote}</span>
          <button type="button" className={panel.button} onClick={() => setSettingsOpen(true)}>
            {t.aiSetUp}
          </button>
        </div>
      </div>
    )
  }

  const running = ai.status.state === 'running'
  // The Enter that commits IME conversion must not send the request (Safari sends it as keyCode 229).
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault()
  }
  return (
    <div className={styles.bar} data-ai-bar>
      <form
        className={styles.row}
        onSubmit={(e) => {
          e.preventDefault()
          if (!running) ai.generate()
        }}
      >
        <input
          className={`${panel.input} ${styles.request}`}
          aria-label={t.aiRequestLabel}
          placeholder={t.aiPlaceholder}
          value={ai.request}
          disabled={!selected}
          onChange={(e) => ai.setRequest(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {running ? (
          <button type="button" className={panel.button} onClick={ai.cancel}>
            {t.cancel}
          </button>
        ) : (
          <button type="submit" className={`${panel.button} ${panel.primary}`} disabled={!selected || !ai.request.trim()}>
            {t.aiGenerate}
          </button>
        )}
        <span className={`${panel.meta} ${styles.model}`} title={ai.label}>
          {ai.label}
        </span>
      </form>
      <div className={styles.row}>
        <span className={panel.meta}>{t.aiSends}</span>
        {ai.objectChip && <Chip text={t.aiObjectChip(ai.objectChip)} onRemove={ai.removeObjectChip} />}
        {ai.editorChip && <Chip text={t.aiEditorChip} onRemove={ai.removeEditorChip} />}
        {!ai.objectChip && <span className={panel.meta}>{t.aiObjectsChosenByAi}</span>}
        {ai.status.state === 'running' && (
          <span role="status" className={`${panel.meta} ${styles.status}`}>
            {t.aiStep[ai.status.step]}
          </span>
        )}
      </div>
      {ai.status.state === 'error' && (
        <div role="alert" className={styles.error}>
          <span>{ai.status.message}</span>
          {ai.status.details !== undefined && (
            <details>
              <summary>{t.errorDetails}</summary>
              <pre className={styles.details}>
                {typeof ai.status.details === 'string' ? ai.status.details : JSON.stringify(ai.status.details, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function Chip({ text, onRemove }: { text: string; onRemove: () => void }) {
  return (
    <span className={styles.chip}>
      {text}
      <button type="button" className={styles.chipRemove} aria-label={t.aiRemoveChip(text)} title={t.aiRemoveChip(text)} onClick={onRemove}>
        ×
      </button>
    </span>
  )
}

export function ProposalCard() {
  const ai = useAi()
  const p = ai.proposal
  if (!p) return null
  const parts = p.before.trim() ? diffWords(p.before, p.soql) : undefined
  return (
    <section className={styles.card} aria-label={t.aiProposal}>
      <pre className={styles.proposal}>
        {parts
          ? parts.map((part, i) => (
              <span key={i} className={part.kind === 'same' ? undefined : styles[part.kind]}>
                {part.text}
              </span>
            ))
          : p.soql}
      </pre>
      {/* Plain text only: never rendered as Markdown or HTML (docs/ai.md "プロンプトインジェクション"). */}
      {p.explanation && <p className={styles.explanation}>{p.explanation}</p>}
      <div className={styles.actions}>
        <button type="button" className={panel.button} onClick={ai.discard}>
          {t.aiDiscard}
        </button>
        <button type="button" className={panel.button} onClick={() => ai.apply(false)}>
          {t.aiReplace}
        </button>
        <button type="button" className={`${panel.button} ${panel.primary}`} onClick={() => ai.apply(true)}>
          {t.aiReplaceRun}
        </button>
      </div>
    </section>
  )
}

/** "Fix with AI" under a query that Salesforce rejected. */
export function FixWithAi({ error }: { error: string }) {
  const ai = useAi()
  if (ai.availability !== 'ready') return null
  return (
    <button type="button" className={panel.button} disabled={ai.status.state === 'running'} onClick={() => ai.fix(error)}>
      {t.aiFix}
    </button>
  )
}
