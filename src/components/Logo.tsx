import { useId } from 'react'

type LogoProps = {
  size?: 'sm' | 'lg'
  wordmark?: boolean
  className?: string
}

export function Logo({ size = 'lg', wordmark = true, className = '' }: LogoProps) {
  const uid = useId().replace(/:/g, '')
  const bubbleId = `logoBubble-${uid}`
  const ringId = `logoRing-${uid}`

  return (
    <div className={`logo logo--${size} ${className}`.trim()} aria-label="chatrive">
      <svg
        className="logo__mark"
        viewBox="0 0 80 80"
        role="img"
        aria-hidden={wordmark ? true : undefined}
      >
        <defs>
          <linearGradient id={bubbleId} x1="16" y1="12" x2="68" y2="68" gradientUnits="userSpaceOnUse">
            <stop stopColor="#0EA5E9" />
            <stop offset="0.55" stopColor="#06B6D4" />
            <stop offset="1" stopColor="#6366F1" />
          </linearGradient>
          <linearGradient id={ringId} x1="8" y1="8" x2="72" y2="72" gradientUnits="userSpaceOnUse">
            <stop stopColor="#38BDF8" stopOpacity="1" />
            <stop offset="0.5" stopColor="#F43F5E" stopOpacity="0.55" />
            <stop offset="1" stopColor="#818CF8" stopOpacity="0" />
          </linearGradient>
        </defs>

        <rect x="8" y="8" width="64" height="64" rx="20" fill={`url(#${bubbleId})`} />
        <circle
          className="logo__orbit"
          cx="40"
          cy="40"
          r="28"
          fill="none"
          stroke={`url(#${ringId})`}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeDasharray="40 140"
        />
        <path
          className="logo__bubble"
          d="M26 30c0-4.4 3.6-8 8-8h14c4.4 0 8 3.6 8 8v10c0 4.4-3.6 8-8 8H40l-7 6.5V48h-0c-4.4 0-8-3.6-8-8V30z"
          fill="rgba(255,255,255,0.92)"
        />
        <circle className="logo__dot logo__dot--1" cx="35" cy="35" r="2.2" fill="#0EA5E9" />
        <circle className="logo__dot logo__dot--2" cx="42" cy="35" r="2.2" fill="#0EA5E9" />
        <circle className="logo__dot logo__dot--3" cx="49" cy="35" r="2.2" fill="#F43F5E" />
      </svg>

      {wordmark ? (
        <span className="logo__word">
          Chat<em>rive</em>
        </span>
      ) : null}
    </div>
  )
}
