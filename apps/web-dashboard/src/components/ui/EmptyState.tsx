// ---------------------------------------------------------------------------
// EmptyState — placeholder when a list/panel has no data.
// ---------------------------------------------------------------------------

interface EmptyStateProps {
  message?: string
}

export function EmptyState({ message = 'No data yet' }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-zinc-600">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" />
        <path d="M8 12h8M12 8v8" />
      </svg>
      <p className="text-sm">{message}</p>
    </div>
  )
}
