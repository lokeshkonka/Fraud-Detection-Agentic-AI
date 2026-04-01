// ---------------------------------------------------------------------------
// Panel — base glass-dark card used as layout primitive.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react'

interface PanelProps {
  children: ReactNode
  className?: string
  glow?: 'cyan' | 'violet' | 'emerald' | 'red' | 'amber' | 'none'
}

const GLOW: Record<string, string> = {
  cyan: 'shadow-cyan-500/10',
  violet: 'shadow-violet-500/10',
  emerald: 'shadow-emerald-500/10',
  red: 'shadow-red-500/10',
  amber: 'shadow-amber-500/10',
  none: '',
}

export function Panel({ children, className = '', glow = 'none' }: PanelProps) {
  return (
    <div
      className={`rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 shadow-lg ${GLOW[glow]} motion-safe:animate-[fadeIn_.3s_ease] ${className}`}
    >
      {children}
    </div>
  )
}
