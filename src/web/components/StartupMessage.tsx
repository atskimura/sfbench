import type { ReactNode } from 'react'
import styles from './StartupMessage.module.css'
import { CommandText } from './CommandText.tsx'

/** A full-page message shown instead of the workspace, such as an expired launch URL. */
export function StartupMessage({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.box} role="alert">
        <h1 className={styles.title}>sfbench</h1>
        <p>
          <CommandText text={message} />
        </p>
        {children}
      </div>
    </main>
  )
}
