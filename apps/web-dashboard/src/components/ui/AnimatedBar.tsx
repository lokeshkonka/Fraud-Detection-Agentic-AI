// ---------------------------------------------------------------------------
// AnimatedBar — horizontal bar that animates width 0 → target% on mount.
// Uses CSS transition triggered via a delayed requestAnimationFrame.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'

interface AnimatedBarProps {
  value: number
  max?: number
  color?: 'cyan' | 'emerald' | 'red' | 'amber' | 'violet'
  height?: string
  delay?: number
}

const COLOR_CLS: Record<string, string> = {
  cyan: 'bg-cyan-500/70',
  emerald: 'bg-emerald-500/70',
  red: 'bg-red-500/70',
  amber: 'bg-amber-500/70',
  violet: 'bg-violet-500/70',
}

export function AnimatedBar({
  value,
  max = 100,
  color = 'cyan',
  height = 'h-2',
  delay = 0,
}: AnimatedBarProps) {
  const targetPct = Math.min(100, Math.max(0, (value / Math.max(max, 0.0001)) * 100))
  const [width, setWidth] = useState(0)

  useEffect(() => {
    // Schedule the width update after an optional delay, inside a RAF so setState
    // is never called synchronously in the effect body.
    const timeoutId = setTimeout(() => {
      requestAnimationFrame(() => {
        setWidth(targetPct)
      })
    }, delay)
    return () => clearTimeout(timeoutId)
  }, [targetPct, delay])

  return (
    <div className={`w-full overflow-hidden rounded-full bg-zinc-800 ${height}`}>
      <div
        className={`${height} rounded-full ${COLOR_CLS[color]}`}
        style={{ width: `${width}%`, transition: 'width 0.6s ease-out' }}
      />
    </div>
  )
}
