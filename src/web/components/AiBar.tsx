// The AI input above the editor, and the proposal card below it
// (docs/screens.md "AI の入力欄", "AI の提案カード"; docs/ai.md "画面"). AiInput,
// ProposalFrame and DiffText are every screen's; the rest is the SOQL screen's.
import { useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { diffWords } from '../ai/diff.ts'
import { isImeEnter } from '../ime.ts'
import { t } from '../i18n/i18n.ts'
import { useApp } from '../state/AppContext.tsx'
import { useAi, type Rejected } from '../state/AiContext.tsx'
import type { AiSession } from '../state/useAiSession.ts'
import { useSoql } from '../state/SoqlContext.tsx'
import styles from './AiBar.module.css'
import { ErrorDetails } from './ErrorDetails.tsx'
import panel from './Panel.module.css'

/** What the shared AI input needs from a screen's AI. */
type InputProps = {
  session: Pick<AiSession<unknown, string>, 'availability' | 'label' | 'request' | 'setRequest' | 'running' | 'failure' | 'cancel'>
  /** The text of the step running, if any. */
  stepText: string | undefined
  onGenerate: () => void
  placeholder: string
  /** The row of what is sent, under the input. */
  sends: ReactNode
  /**
   * Counts the times the user was sent here from elsewhere (the result's
   * "use this result"): each time, the input takes the focus, comes into view
   * and flashes, as the user's eyes are on the result below.
   */
  attention?: number
}

/**
 * The AI input of any screen (docs/ai.md "AI の入力欄"): the request, Generate
 * and Cancel, the step, what is sent, and the failure.
 */
export function AiInput({ session, stepText, onGenerate, placeholder, sends, attention = 0 }: InputProps) {
  const { setSettingsOpen } = useApp()
  const compositionEndedAt = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (attention === 0) return
    input.current?.focus()
    input.current?.scrollIntoView({ block: 'nearest' })
    // A flash of the accent; a steady outline for those who ask for less motion.
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const lit = { boxShadow: 'inset 0 0 0 2px var(--color-accent)', backgroundColor: 'var(--color-accent-soft)' }
    bar.current?.animate?.(still ? [lit, lit] : [lit, { ...lit, offset: 0.4 }, { boxShadow: 'inset 0 0 0 2px transparent' }], { duration: 1200, easing: 'ease-out' })
  }, [attention])
  if (session.availability === 'hidden') return null
  if (session.availability === 'setup') {
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

  const { running, failure } = session
  // The Enter that commits IME conversion must not send the request.
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && isImeEnter({ isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode }, compositionEndedAt.current)) e.preventDefault()
  }
  return (
    <div ref={bar} className={running ? `${styles.bar} ${styles.busy}` : styles.bar} data-ai-bar aria-busy={running}>
      <form
        className={styles.row}
        onSubmit={(e) => {
          e.preventDefault()
          // While running, the task ignores it: Enter pressed again sends nothing.
          onGenerate()
        }}
      >
        <input
          ref={input}
          className={`${panel.input} ${styles.request}`}
          aria-label={t.aiRequestLabel}
          placeholder={placeholder}
          value={session.request}
          // Read only while generating: the request running is the one sent when it was pressed.
          readOnly={running}
          onChange={(e) => session.setRequest(e.target.value)}
          onKeyDown={onKeyDown}
          onCompositionEnd={() => (compositionEndedAt.current = Date.now())}
        />
        {running ? (
          <>
            <span role="status" className={styles.progress}>
              <span className={styles.spinner} aria-hidden="true" />
              {stepText}
            </span>
            <button type="button" className={panel.button} onClick={session.cancel}>
              {t.cancel}
            </button>
          </>
        ) : (
          <button type="submit" className={`${panel.button} ${panel.primary}`} disabled={!session.request.trim()}>
            {t.aiGenerate}
          </button>
        )}
        <span className={`${panel.meta} ${styles.model}`} title={session.label}>
          {session.label}
        </span>
      </form>
      <div className={styles.row}>
        <span className={panel.meta}>{t.aiSends}</span>
        {sends}
      </div>
      {failure && (
        <div role="alert" className={styles.error}>
          <span>{failure.message}</span>
          <ErrorDetails details={failure.details} />
        </div>
      )}
    </div>
  )
}

/** The SOQL screen's AI input. */
export function AiBar() {
  const ai = useAi()
  return (
    <AiInput
      session={ai}
      stepText={ai.step && t.aiStep[ai.step]}
      onGenerate={ai.generate}
      placeholder={t.aiPlaceholder}
      sends={
        <>
          {/* Always sent: shown as fixed pills, apart from the one that can be switched. */}
          <SendFixed text={t.aiSendObjectList} title={ai.panelObject ? t.aiOpenObjectHint(ai.panelObject) : undefined} />
          <SendFixed text={t.aiSendChosenFields} />
          {ai.hasEditorText && <Send text={t.aiEditorChip} checked={ai.sendEditor} onChange={ai.setSendEditor} />}
        </>
      }
    />
  )
}

/** Something always sent: a fixed pill. */
export function SendFixed({ text, title }: { text: string; title?: string }) {
  return (
    <span className={styles.sendFixed} title={title}>
      <SendMark />
      {text}
    </span>
  )
}

/**
 * One thing the AI may be sent: a pill pressed while it is sent. Not a
 * checkbox, so that it does not read as one of the editor's toggles below.
 */
export function Send({ text, title, checked, onChange }: { text: string; title?: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" className={styles.send} aria-pressed={checked} title={title} onClick={() => onChange(!checked)}>
      <SendMark shown={checked} />
      {text}
    </button>
  )
}

function SendMark({ shown = true }: { shown?: boolean }) {
  return (
    <span className={styles.sendMark} aria-hidden="true">
      {shown ? '✓' : ''}
    </span>
  )
}

/** The card of any screen's proposal: what is proposed, the explanation, and the buttons. */
export function ProposalFrame({ explanation, onDiscard, actions, children }: { explanation: string; onDiscard: () => void; actions: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.card} aria-label={t.aiProposal} data-ai-proposal>
      {children}
      {/* Plain text only: never rendered as Markdown or HTML (docs/ai.md "プロンプトインジェクション"). */}
      {explanation && <p className={styles.explanation}>{explanation}</p>}
      <div className={styles.actions}>
        <button type="button" className={panel.button} onClick={onDiscard}>
          {t.aiDiscard}
        </button>
        {actions}
      </div>
    </section>
  )
}

/** Words of `before` and `after`, marked where they differ; undefined when there is nothing to compare or the diff is unreadable. */
export function DiffText({ before, after, stale }: { before: string; after: string; stale: boolean }) {
  // The card redraws as the request is typed; the diff is worked out once per proposal.
  const parts = useMemo(() => (before.trim() ? diffWords(before, after) : undefined), [before, after])
  // Once the text changes, the card does not follow it: the proposal shows alone,
  // so that the diff never misstates what Replace removes.
  const shown = stale ? undefined : parts
  return (
    <>
      <pre className={styles.proposal}>
        {shown
          ? shown.map((part, i) => (
              <span key={i} className={part.kind === 'same' ? undefined : styles[part.kind]}>
                {part.text}
              </span>
            ))
          : after}
      </pre>
      {stale && before.trim() && <p className={panel.meta}>{t.aiDiffStale}</p>}
    </>
  )
}

export function ProposalCard() {
  const ai = useAi()
  const { settledText } = useSoql()
  const p = ai.proposal
  if (!p) return null
  return (
    <ProposalFrame
      explanation={p.explanation}
      onDiscard={ai.discard}
      actions={
        <>
          <button type="button" className={panel.button} onClick={() => ai.apply(false)}>
            {t.aiReplace}
          </button>
          <button type="button" className={`${panel.button} ${panel.primary}`} onClick={() => ai.apply(true)}>
            {t.aiReplaceRun}
          </button>
        </>
      }
    >
      {/* Against the editor when the proposal arrived. */}
      <DiffText before={p.before} after={p.soql} stale={settledText !== p.before} />
    </ProposalFrame>
  )
}

/** "Fix with AI" under a query that Salesforce rejected. */
export function FixWithAi({ error, rejected }: { error: string; rejected: Rejected }) {
  const ai = useAi()
  if (ai.availability !== 'ready') return null
  return (
    <button type="button" className={panel.button} disabled={ai.running} onClick={() => ai.fix(error, rejected)}>
      {t.aiFix}
    </button>
  )
}
