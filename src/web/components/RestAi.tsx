// The REST API screen's AI input and proposal card (docs/ai-agent.md "画面"),
// built on the AI parts every screen shares.
import { t } from '../i18n/i18n.ts'
import type { RestSnapshot } from '../rest/request.ts'
import { useRest } from '../state/RestContext.tsx'
import { useRestAi } from '../state/RestAiContext.tsx'
import { AiInput, DiffText, ProposalFrame, Send, SendFixed } from './AiBar.tsx'
import panel from './Panel.module.css'
import styles from './RestScreen.module.css'

export function RestAiBar() {
  const ai = useRestAi()
  return (
    <AiInput
      session={ai}
      stepText={ai.step && t.aiThinking}
      onGenerate={ai.generate}
      placeholder={t.aiRestPlaceholder}
      sends={
        <>
          <SendFixed text={t.aiSendMetadata} />
          {ai.hasCurrent && <Send text={t.aiSendCurrentRequest} checked={ai.sendCurrent} onChange={ai.setSendCurrent} />}
        </>
      }
    />
  )
}

export function RestProposalCard() {
  const ai = useRestAi()
  const rest = useRest()
  const p = ai.proposal
  if (!p) return null
  return (
    <ProposalFrame
      explanation={p.explanation}
      onDiscard={ai.discard}
      actions={
        // Only Replace: the request may change data, so it is read before it is sent (docs/ai.md "範囲").
        <button type="button" className={`${panel.button} ${panel.primary}`} onClick={ai.apply}>
          {t.aiReplace}
        </button>
      }
    >
      <p className={styles.proposalLine} aria-label={t.aiProposalRequest}>
        <span className={`${styles.method} ${styles[`method${p.method}`]}`}>{p.method}</span>
        <code className={styles.path}>{p.path}</code>
      </p>
      {/* Against the body when the proposal arrived; the card says when the body has changed since. */}
      {p.body.trim() !== '' && <DiffText before={p.before} after={p.body} stale={rest.getBody() !== p.before} />}
    </ProposalFrame>
  )
}

/** "Fix with AI" under a response Salesforce answered with an error, for the request as it was sent. */
export function FixRestWithAi({ sent, status, body }: { sent: RestSnapshot; status: number; body: string }) {
  const ai = useRestAi()
  if (ai.availability !== 'ready' || status < 400) return null
  return (
    <button type="button" className={panel.button} disabled={ai.running} title={t.aiSendError} onClick={() => ai.fix(sent, status, body)}>
      {t.aiFix}
    </button>
  )
}
