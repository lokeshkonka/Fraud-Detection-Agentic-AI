// ---------------------------------------------------------------------------
// AppShell — top header + sidebar + content area layout wrapper.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react'
import { Navbar } from './Navbar'
import type { RouteKey } from './Navbar'
import { StatusDot } from '../ui/StatusDot'

interface AppShellProps {
  route: RouteKey
  onNavigate: (r: RouteKey) => void
  gatewayStatus?: string
  onRefreshAll: () => void
  children: ReactNode
}

export function AppShell({
  route,
  onNavigate,
  gatewayStatus,
  onRefreshAll,
  children,
}: AppShellProps) {
  return (
    <div className="min-h-screen">
      {/* Top header bar */}
      <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 px-4 py-3 backdrop-blur-sm md:px-6">
        <div className="mx-auto flex max-w-400 items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-500/40 bg-zinc-900/80 p-1"
              style={{
                boxShadow: '0 0 0 2px rgba(6,182,212,0.25), 0 0 0 4px rgba(139,92,246,0.15)',
              }}
            >
              <img src="/icon.png" alt="Fraud Detection logo" className="h-full w-full rounded object-contain" />
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-semibold text-zinc-100">Fraud Detection AI</p>
              <p className="text-[10px] text-zinc-500">Enterprise Command Center</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {gatewayStatus && (
              <StatusDot status={gatewayStatus} label="gateway" />
            )}
            <button
              type="button"
              onClick={onRefreshAll}
              className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-cyan-500/50 hover:text-cyan-200"
            >
              ↻ Refresh
            </button>
          </div>
        </div>
      </header>

      {/* Animated gradient top-border bar */}
      <div
        className="h-px w-full"
        style={{
          background: 'linear-gradient(to right, #06b6d4, #8b5cf6, #06b6d4)',
          backgroundSize: '200% 100%',
          animation: 'gradientSweep 3s ease infinite',
        }}
      />

      {/* Mobile nav */}
      <div className="border-b border-zinc-800/60 bg-zinc-950/80 px-4 py-3 lg:hidden">
        <Navbar current={route} onNavigate={onNavigate} />
      </div>

      {/* Page body */}
      <div className="mx-auto flex max-w-400 gap-6 px-4 py-6 md:px-6">
        {/* Desktop sidebar */}
        <div className="hidden lg:flex lg:shrink-0">
          <div className="sticky top-20 h-fit">
            <Navbar current={route} onNavigate={onNavigate} />
          </div>
        </div>

        {/* Main content */}
        <main className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  )
}
