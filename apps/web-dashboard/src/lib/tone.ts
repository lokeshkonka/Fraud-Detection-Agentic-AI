// Shared tone mapping — kept in its own module so Badge.tsx only exports components.

const TONE_MAP: Record<string, string> = {
  // decisions
  approve: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  step_up_auth: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  hold: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  freeze: 'bg-red-500/15 text-red-300 border-red-500/30',
  // labels
  fraud: 'bg-red-500/15 text-red-300 border-red-500/30',
  legit: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  // health
  ok: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  degraded: 'bg-red-500/15 text-red-300 border-red-500/30',
  // model
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  shadow: 'bg-zinc-700/60 text-zinc-300 border-zinc-600',
  promoted: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  // case status
  open: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  investigating: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  closed: 'bg-zinc-700/60 text-zinc-400 border-zinc-600',
  escalated: 'bg-red-500/15 text-red-300 border-red-500/30',
  // severity
  low: 'bg-zinc-700/60 text-zinc-400 border-zinc-600',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  high: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  critical: 'bg-red-500/15 text-red-300 border-red-500/30',
}

export function tone(value: string): string {
  return TONE_MAP[value.toLowerCase()] ?? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
}
