// ---------------------------------------------------------------------------
// KpiCard — metric tile with animated counter from 0 → final over 800ms.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { Panel } from './Panel'

interface KpiCardProps {
  label: string
  value: string | number | null | undefined
  sub?: string
  accent?: 'cyan' | 'violet' | 'emerald' | 'amber' | 'red'
  animate?: boolean
  delay?: number
}

const ACCENT_CLS: Record<string, string> = {
  cyan: 'text-cyan-200',
  violet: 'text-violet-200',
  emerald: 'text-emerald-200',
  amber: 'text-amber-200',
  red: 'text-red-300',
}

export function KpiCard({ label, value, sub, accent = 'cyan', animate = true, delay = 0 }: KpiCardProps) {
  // Parse: extract numeric prefix + suffix (e.g. "12.3%" → 12.3, "%")
  let numValue: number | null = null
  let suffix = ''
  let fallback = '—'

  if (value === null || value === undefined) {
    fallback = '—'
  } else if (typeof value === 'number') {
    numValue = value
  } else {
    const str = String(value)
    const match = /^([\d.]+)(.*)$/.exec(str)
    if (match) {
      numValue = parseFloat(match[1])
      suffix = match[2]
    } else {
      fallback = str
    }
  }

  const shouldAnimate = animate && numValue !== null
  const [displayNum, setDisplayNum] = useState(0)

  useEffect(() => {
    if (!shouldAnimate || numValue === null) return
    const target = numValue
    // Two-stage RAF: first frame resets to 0 (async, not sync in effect body)
    let rafId = requestAnimationFrame(() => {
      setDisplayNum(0)
      const duration = 800
      const startTime = performance.now()
      const tick = (now: number) => {
        const progress = Math.min((now - startTime) / duration, 1)
        const eased = 1 - Math.pow(1 - progress, 3) // ease-out cubic
        setDisplayNum(target * eased)
        if (progress < 1) {
          rafId = requestAnimationFrame(tick)
        }
      }
      rafId = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(rafId)
  }, [shouldAnimate, numValue])

  let display: string
  if (numValue === null) {
    display = fallback
  } else if (shouldAnimate) {
    if (suffix === '%') display = `${displayNum.toFixed(1)}%`
    else if (suffix === '') display = `${Math.round(displayNum)}`
    else display = `${displayNum.toFixed(2)}${suffix}`
  } else {
    display = suffix ? `${numValue}${suffix}` : `${numValue}`
  }

  return (
    <Panel delay={delay}>
      <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">{label}</p>
      <p className={`mt-3 text-3xl font-semibold tabular-nums ${ACCENT_CLS[accent]}`}>{display}</p>
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
    </Panel>
  )
}
