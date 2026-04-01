// ---------------------------------------------------------------------------
// Panel — base glass-dark card used as layout primitive.
// ---------------------------------------------------------------------------

import type { CSSProperties, ReactNode } from 'react'

interface PanelProps {
  children: ReactNode
  className?: string
  glow?: 'cyan' | 'violet' | 'emerald' | 'red' | 'amber' | 'none'
  delay?: number
}

const GLOW_SHADOW: Record<string, string> = {
  cyan: '0 0 18px 2px rgba(6,182,212,0.14), 0 0 1px 0 rgba(6,182,212,0.4)',
  violet: '0 0 18px 2px rgba(139,92,246,0.14), 0 0 1px 0 rgba(139,92,246,0.4)',
  emerald: '0 0 18px 2px rgba(16,185,129,0.14), 0 0 1px 0 rgba(16,185,129,0.4)',
  red: '0 0 18px 2px rgba(239,68,68,0.14), 0 0 1px 0 rgba(239,68,68,0.4)',
  amber: '0 0 18px 2px rgba(245,158,11,0.14), 0 0 1px 0 rgba(245,158,11,0.4)',
  none: '0 2px 8px 0 rgba(0,0,0,0.4)',
}

export function Panel({ children, className = '', glow = 'none', delay = 0 }: PanelProps) {
  const style: CSSProperties = {
    boxShadow: GLOW_SHADOW[glow],
    animationDelay: delay > 0 ? `${delay}ms` : undefined,
  }
  return (
    <div
      className={`rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 motion-safe:animate-[fadeIn_.3s_ease_both] ${className}`}
      style={style}
    >
      {children}
    </div>
  )
}
