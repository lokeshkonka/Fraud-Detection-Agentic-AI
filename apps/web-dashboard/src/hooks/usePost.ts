import { useCallback, useState } from 'react'
import { apiPost } from '../lib/api'

export type PostStatus = 'idle' | 'pending' | 'success' | 'error'

export interface PostState<T> {
  data: T | null
  status: PostStatus
  error: string | null
}

export function usePost<T>(
  base: string,
  path: string,
): [PostState<T>, (body?: unknown) => Promise<T | null>, () => void] {
  const [state, setState] = useState<PostState<T>>({
    data: null,
    status: 'idle',
    error: null,
  })

  const execute = useCallback(
    async (body?: unknown): Promise<T | null> => {
      setState({ data: null, status: 'pending', error: null })
      try {
        const data = await apiPost<T>(base, path, body)
        setState({ data, status: 'success', error: null })
        return data
      } catch (err) {
        setState({
          data: null,
          status: 'error',
          error: err instanceof Error ? err.message : `POST ${path} failed`,
        })
        return null
      }
    },
    [base, path],
  )

  const reset = useCallback(() => {
    setState({ data: null, status: 'idle', error: null })
  }, [])

  return [state, execute, reset]
}
