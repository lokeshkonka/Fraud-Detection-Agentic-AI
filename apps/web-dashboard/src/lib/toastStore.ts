// ---------------------------------------------------------------------------
// toastStore — module-level singleton that coordinates toast state between
// the useToast hook and the ToastContainer component.
// ---------------------------------------------------------------------------

export type ToastType = 'success' | 'error' | 'info'

export interface ToastItem {
  id: string
  message: string
  type: ToastType
  exiting: boolean
}

type Listener = (toasts: ToastItem[]) => void

let _toasts: ToastItem[] = []
const _listeners = new Set<Listener>()

function _broadcast(): void {
  const snapshot = [..._toasts]
  _listeners.forEach((l) => l(snapshot))
}

export function addToast(message: string, type: ToastType): void {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  _toasts = [..._toasts, { id, message, type, exiting: false }]
  _broadcast()

  // After 3.7s mark as exiting; after 4s remove.
  setTimeout(() => {
    _toasts = _toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t))
    _broadcast()
    setTimeout(() => {
      _toasts = _toasts.filter((t) => t.id !== id)
      _broadcast()
    }, 300)
  }, 3700)
}

export function subscribe(listener: Listener): () => void {
  _listeners.add(listener)
  return () => {
    _listeners.delete(listener)
  }
}
