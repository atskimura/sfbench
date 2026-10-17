// The button in a panel header that closes the panel (docs/screens.md "パネルの開閉").
import { usePanels, type PanelName } from '../state/PanelsContext.tsx'
import panel from './Panel.module.css'

/** `side` is where the panel collapses to: the chevron points that way. */
export function CollapseButton({ name, label, side }: { name: PanelName; label: string; side: 'left' | 'right' }) {
  const { setOpen } = usePanels()
  return (
    <button type="button" className={panel.button} aria-label={label} title={label} onClick={() => setOpen(name, false)}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d={side === 'left' ? 'M10 3L5 8l5 5' : 'M6 3l5 5-5 5'} />
      </svg>
    </button>
  )
}
