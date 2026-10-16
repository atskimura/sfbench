import panel from './Panel.module.css'

export function ReloadButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className={panel.button} title={label} aria-label={label} aria-busy={busy} disabled={busy} onClick={onClick}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
        <path d="M13.5 2.5v3.2h-3.2" />
      </svg>
    </button>
  )
}
