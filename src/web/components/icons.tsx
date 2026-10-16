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
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      {/* An 8-tooth cog with a hole in the middle. */}
      <path d="M16.11 8.11 L18.04 8.37 L18.04 11.63 L16.11 11.89 L15.66 12.99 L16.83 14.53 L14.53 16.83 L12.99 15.66 L11.89 16.11 L11.63 18.04 L8.37 18.04 L8.11 16.11 L7.01 15.66 L5.47 16.83 L3.17 14.53 L4.34 12.99 L3.89 11.89 L1.96 11.63 L1.96 8.37 L3.89 8.11 L4.34 7.01 L3.17 5.47 L5.47 3.17 L7.01 4.34 L8.11 3.89 L8.37 1.96 L11.63 1.96 L11.89 3.89 L12.99 4.34 L14.53 3.17 L16.83 5.47 L15.66 7.01 Z" />
      <circle cx="10" cy="10" r="2.6" />
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
