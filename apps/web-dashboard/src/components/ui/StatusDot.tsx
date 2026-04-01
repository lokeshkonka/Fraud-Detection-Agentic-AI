// ---------------------------------------------------------------------------
// StatusDot — animated status indicator with pulsing ring.
// "ok" → emerald pulse, "degraded" → red pulse, otherwise → amber static.
// ---------------------------------------------------------------------------

interface StatusDotProps {
  status: string
  label: string
}

export function StatusDot({ status, label }: StatusDotProps) {
  const isOk = status === 'ok'
  const isDegraded = status === 'degraded'

  const dotCls = isOk
    ? 'bg-emerald-400'
    : isDegraded
      ? 'bg-red-400'
      : 'bg-amber-400'

  const ringCls = isOk
    ? 'bg-emerald-400'
    : isDegraded
      ? 'bg-red-400'
      : 'bg-amber-400'

  const textCls = isOk
    ? 'text-emerald-400'
    : isDegraded
      ? 'text-red-400'
      : 'text-amber-400'

  const shouldPulse = isOk || isDegraded

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex h-3 w-3 items-center justify-center">
        {shouldPulse && (
          <span
            className={`animate-ping-slow absolute inline-flex h-full w-full rounded-full ${ringCls} opacity-75`}
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dotCls}`} />
      </div>
      <span className="text-xs text-zinc-400">{label}</span>
      <span className={`text-[10px] font-medium ${textCls}`}>{status}</span>
    </div>
  )
}
