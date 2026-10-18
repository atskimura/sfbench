// Copies a text and says so for a moment: the REST API response and the Apex debug log.
import { useEffect, useState } from 'react'
import { t } from '../i18n/i18n.ts'
import panel from './Panel.module.css'

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <button
      type="button"
      className={panel.button}
      onClick={() => {
        // As CopyCommand: a refused clipboard shows nothing and throws nothing.
        navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => setCopied(false),
        )
      }}
    >
      {copied ? t.restCopied : t.restCopy}
    </button>
  )
}
