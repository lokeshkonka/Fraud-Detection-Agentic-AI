import { CSSProperties, FormEvent, useEffect, useMemo, useState } from 'react'
import './App.css'

type GatewayHealth = {
  status: string
  inference_status?: string
  ml_inference_url?: string
}

type RoutesPayload = {
  routes: string[]
}

type ScorePayload = {
  score: number
  label: 'fraud' | 'legit' | string
  reasons: string[]
}

type EventItem = {
  id: string
  at: string
  score: number
  label: string
}

const CHANNELS = ['card', 'wire', 'crypto', 'ach', 'upi']

function resolveApiBase(): string {
  const envBase = import.meta.env.VITE_API_BASE_URL as string | undefined
  if (envBase && envBase.trim().length > 0) {
    return envBase.trim().replace(/\/$/, '')
  }

  if (window.location.port === '' || window.location.port === '80') {
    return '/api'
  }

  return 'http://localhost:8000'
}

function createTransactionId(): string {
  return `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function App() {
  const apiBase = useMemo(resolveApiBase, [])
  const [health, setHealth] = useState<GatewayHealth | null>(null)
  const [routeCount, setRouteCount] = useState<number>(0)
  const [score, setScore] = useState<ScorePayload | null>(null)
  const [events, setEvents] = useState<EventItem[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isScoring, setIsScoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    amount: '1250',
    merchant: '',
    channel: 'card',
    velocity: '2',
  })

  async function refreshGatewayState() {
    setIsRefreshing(true)
    try {
      const [healthResp, routesResp] = await Promise.all([
        fetch(`${apiBase}/health`),
        fetch(`${apiBase}/routes`),
      ])

      if (!healthResp.ok || !routesResp.ok) {
        throw new Error('Gateway health probe failed')
      }

      const healthPayload = (await healthResp.json()) as GatewayHealth
      const routesPayload = (await routesResp.json()) as RoutesPayload
      setHealth(healthPayload)
      setRouteCount(routesPayload.routes.length)
      setError(null)
    } catch {
      setHealth(null)
      setRouteCount(0)
      setError('Unable to reach API Gateway. Verify services and ports.')
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    void refreshGatewayState()
  }, [apiBase])

  function updateField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function submitTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsScoring(true)

    try {
      const amount = Number(form.amount)
      const velocity = Number(form.velocity)

      const payload = {
        transaction_id: createTransactionId(),
        user_id: 'demo-user',
        amount: Number.isFinite(amount) ? amount : 0,
        merchant: form.merchant.trim() || null,
        channel: form.channel,
        timestamp: new Date().toISOString(),
        features: {
          velocity: Number.isFinite(velocity) ? velocity : 0,
        },
      }

      const response = await fetch(`${apiBase}/score`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error('Scoring request failed')
      }

      const result = (await response.json()) as ScorePayload
      setScore(result)
      setEvents((prev) => [
        {
          id: payload.transaction_id,
          at: new Date().toLocaleTimeString(),
          score: result.score,
          label: result.label,
        },
        ...prev,
      ].slice(0, 6))
      setError(null)
    } catch {
      setError('Scoring failed. Check if gateway and inference services are running.')
    } finally {
      setIsScoring(false)
    }
  }

  const riskPercent = Math.round((score?.score ?? 0) * 100)
  const isHighRisk = (score?.label ?? 'legit').toLowerCase() === 'fraud'

  return (
    <div className="command-center">
      <header className="hero-panel">
        <p className="eyebrow">Fraud Detection Command Center</p>
        <h1>Real-time Transaction Risk Console</h1>
        <p className="subhead">
          Streamline fraud triage with instant scoring, gateway status, and decision reasons.
        </p>
        <button type="button" onClick={() => void refreshGatewayState()} disabled={isRefreshing}>
          {isRefreshing ? 'Refreshing...' : 'Refresh Status'}
        </button>
      </header>

      <section className="metrics-grid">
        <article className="metric-card">
          <h2>Gateway</h2>
          <p className={`metric-value ${health ? 'ok' : 'down'}`}>{health?.status ?? 'offline'}</p>
        </article>
        <article className="metric-card">
          <h2>Inference Link</h2>
          <p className={`metric-value ${health?.inference_status === 'ok' ? 'ok' : 'down'}`}>
            {health?.inference_status ?? 'unknown'}
          </p>
        </article>
        <article className="metric-card">
          <h2>Discovered Routes</h2>
          <p className="metric-value">{routeCount}</p>
        </article>
        <article className="metric-card">
          <h2>API Base</h2>
          <p className="small-copy">{apiBase}</p>
        </article>
      </section>

      <section className="work-grid">
        <article className="panel">
          <h2>Score a Transaction</h2>
          <form className="transaction-form" onSubmit={(event) => void submitTransaction(event)}>
            <label>
              Amount (USD)
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(event) => updateField('amount', event.target.value)}
              />
            </label>

            <label>
              Channel
              <select
                value={form.channel}
                onChange={(event) => updateField('channel', event.target.value)}
              >
                {CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Merchant (optional)
              <input
                type="text"
                value={form.merchant}
                onChange={(event) => updateField('merchant', event.target.value)}
                placeholder="merchant-id"
              />
            </label>

            <label>
              Velocity Feature
              <input
                type="number"
                min="0"
                step="1"
                value={form.velocity}
                onChange={(event) => updateField('velocity', event.target.value)}
              />
            </label>

            <button type="submit" disabled={isScoring}>
              {isScoring ? 'Scoring...' : 'Run Risk Score'}
            </button>
          </form>
        </article>

        <article className="panel score-panel">
          <h2>Latest Decision</h2>
          <div className={`risk-ring ${isHighRisk ? 'risk-high' : 'risk-low'}`} style={{ '--risk': riskPercent } as CSSProperties}>
            <strong>{score ? `${riskPercent}%` : '--'}</strong>
            <span>risk</span>
          </div>

          <p className="decision">
            Label: <strong>{score?.label ?? 'pending'}</strong>
          </p>

          <div className="reasons">
            {(score?.reasons ?? ['No score requested yet']).map((reason) => (
              <span key={reason}>{reason}</span>
            ))}
          </div>
        </article>
      </section>

      <section className="panel event-panel">
        <h2>Recent Requests</h2>
        <ul>
          {events.length === 0 && <li className="empty">No transactions scored in this session.</li>}
          {events.map((item) => (
            <li key={item.id}>
              <p>{item.id}</p>
              <p>{item.at}</p>
              <p>{Math.round(item.score * 100)}%</p>
              <p className={item.label.toLowerCase() === 'fraud' ? 'risk-high' : 'risk-low'}>{item.label}</p>
            </li>
          ))}
        </ul>
      </section>

      {error && <p className="error-banner">{error}</p>}
    </div>
  )
}

export default App
