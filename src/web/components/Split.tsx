// The pieces for panels that close (docs/screens.md "パネルの開閉"): the
// narrow bar a closed side panel becomes, and the open and close button on
// the border between the top area and the results below.
import panel from './Panel.module.css'
import styles from './Split.module.css'

/** A closed panel: a narrow vertical bar that opens it. */
export function Strip({ label, text, onClick }: { label: string; text: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.strip} aria-label={label} title={label} onClick={onClick}>
      <span className={styles.stripText}>{text}</span>
    </button>
  )
}

/** The button that closes or opens the top area, on its border with the area below. */
export function Divider({ open, showLabel, hideLabel, onToggle }: { open: boolean; showLabel: string; hideLabel: string; onToggle: () => void }) {
  return (
    <div className={styles.divider}>
      <button type="button" className={`${panel.button} ${styles.dividerButton}`} onClick={onToggle} aria-expanded={open}>
        {open ? hideLabel : showLabel}
      </button>
    </div>
  )
}
