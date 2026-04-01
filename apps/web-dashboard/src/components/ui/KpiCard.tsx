// ---------------------------------------------------------------------------
// KpiCard — metric tile showing a label + large number with optional sub-text.
// ---------------------------------------------------------------------------

import { Panel } from './Panel'

interface KpiCardProps {
  label: string
  value: string | number | null | undefined
  sub?: string
  accent?: 'cyan' | 'violet' | 'emerald' | 'amber' | 'red'
}

const ACCENT_CLS: Record<string, string> = {
  cyan: 'text-cyan-200',
  violet: 'text-violet-200',
  emerald: 'text-emerald-200',
  amber: 'text-amber-200',
  red: 'text-red-300',
}

export function KpiCard({ label, value, sub, accent = 'cyan' }: KpiCardProps) {
  const display = value === null || value === undefined ? '—' : String(value)
  return (
    <Panel>
      <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">{label}</p>
      <p className={`mt-3 text-3xl font-semibold tabular-nums ${ACCENT_CLS[accent]}`}>{display}</p>
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
    </Panel>
  )
}
