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
  const softId = `logoSoft-${uid}`

  return (
    <div className={`logo logo--${size} ${className}`.trim()} aria-label="chatriv">
      <svg
        className="logo__mark"
        viewBox="0 0 80 80"
        role="img"
        aria-hidden={wordmark ? true : undefined}
      >
        <defs>
          <linearGradient id={bubbleId} x1="18" y1="14" x2="64" y2="66" gradientUnits="userSpaceOnUse">
            <stop stopColor="#1B7A6A" />
            <stop offset="1" stopColor="#0B322C" />
          </linearGradient>
          <linearGradient id={ringId} x1="8" y1="8" x2="72" y2="72" gradientUnits="userSpaceOnUse">
            <stop stopColor="#E11D2E" stopOpacity="1" />
            <stop offset="0.45" stopColor="#FF4D5E" stopOpacity="0.75" />
            <stop offset="1" stopColor="#0F6B5C" stopOpacity="0" />
          </linearGradient>
          <filter id={softId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="0.6" />
          </filter>
        </defs>

        <circle
          className="logo__orbit"
          cx="40"
          cy="40"
          r="30"
          fill="none"
          stroke={`url(#${ringId})`}
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeDasharray="42 146"
        />
        <circle
          className="logo__halo"
          cx="40"
          cy="40"
          r="34"
          fill="none"
          stroke="#E11D2E"
          strokeOpacity="0.16"
          strokeWidth="1"
        />

        <path
          className="logo__bubble"
          d="M24 28c0-5.5 4.5-10 10-10h16c5.5 0 10 4.5 10 10v12c0 5.5-4.5 10-10 10H42l-8.5 7.5V50H34c-5.5 0-10-4.5-10-10V28z"
          fill={`url(#${bubbleId})`}
        />

        <g className="logo__dots" filter={`url(#${softId})`}>
          <circle className="logo__dot logo__dot--1" cx="34" cy="34" r="2.6" fill="#F4FBF8" />
          <circle className="logo__dot logo__dot--2" cx="42" cy="34" r="2.6" fill="#F4FBF8" />
          <circle className="logo__dot logo__dot--3" cx="50" cy="34" r="2.6" fill="#FF6B78" />
        </g>

        <path
          className="logo__vanish"
          d="M28 54c6 4 18 5 28-1"
          fill="none"
          stroke="#E11D2E"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeDasharray="36"
          strokeDashoffset="36"
        />
      </svg>

      {wordmark ? (
        <span className="logo__word">
          chat<em>riv</em>
        </span>
      ) : null}
    </div>
  )
}
