import { useState } from 'react'
import { t } from '../i18n/i18n.ts'
import styles from './CopyCommand.module.css'

/** A command with a copy button, such as `sf org login web -a my-org`. */
export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(command).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => setCopied(false),
    )
  }
  return (
    <span className={styles.command}>
      <code className={styles.text}>{command}</code>
      <button type="button" className={styles.copy} onClick={copy}>
        {copied ? t.copied : t.copy}
      </button>
    </span>
  )
}
