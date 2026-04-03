// ---------------------------------------------------------------------------
// ToastContainer — slide-in toast notification renderer.
// Import useToast from hooks/useToast.ts to trigger notifications.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { subscribe } from '../../lib/toastStore'
import type { ToastItem, ToastType } from '../../lib/toastStore'

const TYPE_CLS: Record<ToastType, string> = {
  success: 'border-emerald-500/40 bg-emerald-900/80 text-emerald-200',
  error: 'border-red-500/40 bg-red-900/80 text-red-200',
  info: 'border-cyan-500/40 bg-cyan-900/80 text-cyan-200',
}

const TYPE_ICON: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    // setToasts is only ever called from the subscribe callback (async context
    // — triggered by addToast from event handlers / timeouts, never synchronously
    // inside this effect body).
    const unsubscribe = subscribe((updated) => {
      setToasts(updated)
    })
    return unsubscribe
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" style={{ maxWidth: '22rem' }}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-xl backdrop-blur-sm ${TYPE_CLS[toast.type]}`}
          style={{
            animation: toast.exiting
              ? 'slideOutDown 0.3s ease forwards'
              : 'slideInUp 0.3s ease',
          }}
        >
          <span className="text-base leading-none">{TYPE_ICON[toast.type]}</span>
          <span className="flex-1">{toast.message}</span>
        </div>
      ))}
    </div>
  )
}
