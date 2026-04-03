// ---------------------------------------------------------------------------
// API client — resolves base URL and wraps fetch with typed helpers.
// ---------------------------------------------------------------------------

export function resolveApiBase(): string {
  const envBase = import.meta.env.VITE_API_BASE_URL as string | undefined
  if (envBase?.trim()) return envBase.trim().replace(/\/$/, '')
  // In production behind nginx the gateway is proxied at /api
  if (window.location.port === '' || window.location.port === '80' || window.location.port === '443') {
    return '/api'
  }
  return 'http://localhost:8000'
}

export async function apiFetch<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!resp.ok) {
    throw new Error(`${resp.status} ${resp.statusText} — ${path}`)
  }
  return resp.json() as Promise<T>
}

export async function apiPost<T>(base: string, path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(base, path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

export async function apiPatch<T>(base: string, path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(base, path, {
    method: 'PATCH',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}
