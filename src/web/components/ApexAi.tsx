// The Apex screen's AI input and proposal card (docs/ai-agent.md "画面"),
// built on the AI parts every screen shares.
import { t } from '../i18n/i18n.ts'
import { useApex } from '../state/ApexContext.tsx'
import { useApexAi } from '../state/ApexAiContext.tsx'
import { AiInput, DiffText, ProposalFrame, Send, SendFixed } from './AiBar.tsx'
import panel from './Panel.module.css'

export function ApexAiBar() {
  const ai = useApexAi()
  return (
    <AiInput
      session={ai}
      stepText={ai.step && t.aiThinking}
      onGenerate={ai.generate}
      placeholder={t.aiApexPlaceholder}
      sends={
        <>
          <SendFixed text={t.aiSendMetadata} />
          {ai.hasCode && <Send text={t.aiSendCurrentCode} checked={ai.sendCode} onChange={ai.setSendCode} />}
        </>
      }
    />
  )
}

export function ApexProposalCard() {
  const ai = useApexAi()
  const apex = useApex()
  const p = ai.proposal
  if (!p) return null
  return (
    <ProposalFrame
      explanation={p.explanation}
      onDiscard={ai.discard}
      actions={
        // Only Replace: Apex may change data, so it is read before it runs (docs/ai.md "範囲").
        <button type="button" className={`${panel.button} ${panel.primary}`} onClick={ai.apply}>
          {t.aiReplace}
        </button>
      }
    >
      {/* Against the code when the proposal arrived; the card says when the code has changed since. */}
      <DiffText before={p.before} after={p.code} stale={apex.getCode() !== p.before} />
    </ProposalFrame>
  )
}

/** "Fix with AI" under a compile error or an exception, for the code as it was run. */
export function FixApexWithAi(failed: { code: string; problem: string; line?: number; column?: number }) {
  const ai = useApexAi()
  if (ai.availability !== 'ready' || !failed.problem) return null
  return (
    <button type="button" className={panel.button} disabled={ai.running} title={t.aiSendError} onClick={() => ai.fix(failed)}>
      {t.aiFix}
    </button>
  )
}
