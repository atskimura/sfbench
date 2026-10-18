// The result table's edit controls (docs/edit.md "画面"): the Edit toggle in
// the header, and while editing, the bar with Save, Undo changes, Delete, the
// all-or-none choice, the progress and the outcome.
import { t } from '../i18n/i18n.ts'
import { useApp } from '../state/AppContext.tsx'
import type { useRecordEdits } from '../state/useRecordEdits.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { CopyCommand } from './CopyCommand.tsx'
import { ErrorDetails } from './ErrorDetails.tsx'
import panel from './Panel.module.css'
import styles from './ResultPanel.module.css'

type Edits = ReturnType<typeof useRecordEdits>

const REASON = { tooling: t.editTooling, aggregate: t.editAggregate, noId: t.editNoId, empty: t.editEmpty } as const

/** "Edit": off by default; turning it off with changes not saved asks first. */
export function EditToggle({ edits }: { edits: Edits }) {
  const { guardDiscard } = useApp()
  const reason = 'reason' in edits.target ? REASON[edits.target.reason] : undefined
  return (
    <button
      type="button"
      className={`${panel.button} ${edits.editing ? styles.editOn : ''}`}
      aria-pressed={edits.editing}
      disabled={reason !== undefined || edits.sending}
      title={reason}
      onClick={() => (edits.editing ? guardDiscard(() => edits.dispatch({ type: 'stop' })) : edits.dispatch({ type: 'start' }))}
    >
      {t.editToggle}
    </button>
  )
}

export function EditBar({ edits }: { edits: Edits }) {
  const { state, sending, progress, message } = edits
  const changes = state.changes.size
  const selected = state.selected.size
  const tooManySave = edits.saveTooManyForAllOrNone
  const tooManyDelete = edits.deleteTooManyForAllOrNone
  return (
    <div className={styles.editBar}>
      {edits.fieldsError !== undefined ? (
        <span className={panel.meta}>{t.editFieldsFailed}</span>
      ) : !edits.fields ? (
        <span className={panel.meta}>{t.editLoadingFields}</span>
      ) : null}
      <button type="button" className={`${panel.button} ${panel.primary}`} disabled={sending || changes === 0 || !edits.fields || tooManySave} onClick={edits.save}>
        {t.saveChanges(changes)}
      </button>
      <button type="button" className={panel.button} disabled={sending || changes === 0} onClick={() => edits.dispatch({ type: 'discard' })}>
        {t.discardChanges}
      </button>
      <button type="button" className={`${panel.button} ${styles.danger}`} disabled={sending || selected === 0 || tooManyDelete} onClick={edits.remove}>
        {t.deleteRows(selected)}
      </button>
      <label className={styles.allOrNone}>
        <input type="checkbox" checked={edits.allOrNone} disabled={sending} onChange={(e) => edits.setAllOrNone(e.target.checked)} />
        {t.allOrNone}
      </label>
      {(tooManySave || tooManyDelete) && <span className={panel.meta}>{t.allOrNoneTooMany}</span>}
      {progress && (
        <span className={panel.meta} role="status">
          {progress.kind === 'save' ? t.savingRows(progress.done, progress.total) : t.deletingRows(progress.done, progress.total)}
        </span>
      )}
      {message && (
        <div className={message.kind === 'done' ? styles.editDone : message.kind === 'unknown' ? styles.editUnknown : styles.editError} role={message.kind === 'done' ? 'status' : 'alert'}>
          <span className={styles.message}>{message.text}</span>
          {message.kind === 'error' && message.reloginCommand && <CopyCommand command={message.reloginCommand} />}
          {message.kind === 'error' && <ErrorDetails details={message.details} />}
          <button type="button" className={styles.messageClose} aria-label={t.dismiss} onClick={edits.closeMessage}>
            ×
          </button>
        </div>
      )}
      {edits.confirming && (
        <ConfirmDialog
          title={edits.confirming.kind === 'save' ? t.confirmSaveTitle : t.confirmDeleteTitle}
          message={edits.confirming.lines.join('\n')}
          confirmLabel={edits.confirming.kind === 'save' ? t.confirmSave : t.confirmDeleteButton}
          onConfirm={edits.confirm}
          onCancel={edits.cancelConfirm}
        />
      )}
    </div>
  )
}
