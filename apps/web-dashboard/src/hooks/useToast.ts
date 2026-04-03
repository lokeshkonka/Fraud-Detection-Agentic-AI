// ---------------------------------------------------------------------------
// useToast — returns a stable addToast callback for triggering notifications.
// ---------------------------------------------------------------------------

import { useCallback } from 'react'
import { addToast } from '../lib/toastStore'
import type { ToastType } from '../lib/toastStore'

export function useToast() {
  return useCallback((message: string, type: ToastType = 'info') => {
    addToast(message, type)
  }, [])
}
