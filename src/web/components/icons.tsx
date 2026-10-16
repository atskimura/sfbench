// Inline stroke icons. They take the text color (currentColor).
type Props = { size?: number }

export function LogoIcon({ size = 20 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="var(--color-ok)" strokeWidth="1.8" strokeLinecap="round">
      <rect x="2.5" y="11" width="15" height="4" rx="1" />
      <path d="M5 11V6.5M15 11V6.5M3.5 6.5h13" />
    </svg>
  )
}

export function GearIcon({ size = 18 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6" />
    </svg>
  )
}

export function HelpIcon({ size = 18 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M7.8 7.6a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.5v.4M10 14.2h.01" />
    </svg>
  )
}

export function ExternalIcon({ size = 18 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M11 3.5h5.5V9M16.5 3.5 9 11M14 12v4.5H3.5V6H8" />
    </svg>
  )
}

export function ChevronDownIcon({ size = 12 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 4.5l3 3 3-3" />
    </svg>
  )
}
