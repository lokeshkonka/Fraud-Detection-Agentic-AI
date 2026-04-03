// ---------------------------------------------------------------------------
// Badge — colour-coded pill for decision/label/status values.
// ---------------------------------------------------------------------------

import { tone } from '../../lib/tone'

interface BadgeProps {
  value: string
  label?: string
  size?: 'sm' | 'md'
}

export function Badge({ value, label, size = 'sm' }: BadgeProps) {
  const cls = tone(value)
  const pad = size === 'md' ? 'px-3 py-1.5 text-sm' : 'px-2 py-1 text-xs'
  return (
    <span className={`inline-flex items-center rounded-md border font-medium ${pad} ${cls}`}>
      {label ?? value}
    </span>
  )
}
