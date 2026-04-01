// ---------------------------------------------------------------------------
// Spinner — animated loading indicator.
// ---------------------------------------------------------------------------

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE: Record<string, string> = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-10 w-10' }

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent text-cyan-400 ${SIZE[size]} ${className}`}
    />
  )
}
