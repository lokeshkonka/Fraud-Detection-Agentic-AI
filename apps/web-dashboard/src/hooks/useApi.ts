import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'

export interface ApiState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export function useApi<T>(
  base: string,
  path: string,
): [ApiState<T>, () => Promise<void>] {
  // `tick` is bumped by refresh() so the effect re-runs without changing path/base.
  const [tick, setTick] = useState(0)
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: true,
    error: null,
  })
  // Track whether a fetch is in-flight so refresh() can set loading via ref
  // rather than calling setState synchronously inside the effect body.
  const loadingRef = useRef(true)

  useEffect(() => {
    let cancelled = false
    loadingRef.current = true

    apiFetch<T>(base, path)
      .then((data) => {
        if (!cancelled) {
          loadingRef.current = false
          setState({ data, loading: false, error: null })
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          loadingRef.current = false
          setState({
            data: null,
            loading: false,
            error: err instanceof Error ? err.message : `Failed to load ${path}`,
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [base, path, tick])

  // Called from event handlers (not inside effects) — safe to setState here.
  const refresh = useCallback(async (): Promise<void> => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    setTick((t) => t + 1)
  }, [])

  return [state, refresh]
}
