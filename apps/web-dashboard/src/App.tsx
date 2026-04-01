import { useCallback, useEffect, useMemo, useState } from 'react'

type RouteKey =
  | '/dashboard'
  | '/transaction-flow'
  | '/simulation-lab'
  | '/graph-intelligence'
  | '/model-lab'
  | '/model-ops'
  | '/cases-audit'
  | '/rule-studio'

type ApiState<T> = {
  data: T | null
  loading: boolean
  error: string | null
}

type ScorePayload = {
  transaction_id: string
  score: number
  label: string
  decision: string
  reasons: string[]
}

const ROUTES: RouteKey[] = [
  '/dashboard',
  '/transaction-flow',
  '/simulation-lab',
  '/graph-intelligence',
  '/model-lab',
  '/model-ops',
  '/cases-audit',
  '/rule-studio',
]

function resolveApiBase(): string {
  const envBase = import.meta.env.VITE_API_BASE_URL as string | undefined
  if (envBase?.trim()) return envBase.trim().replace(/\/$/, '')
  if (window.location.port === '' || window.location.port === '80') return '/api'
  return 'http://localhost:8000'
}

function useApi<T>(apiBase: string, path: string): [ApiState<T>, () => Promise<void>] {
  const [state, setState] = useState<ApiState<T>>({ data: null, loading: true, error: null })

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }))
    try {
      const resp = await fetch(`${apiBase}${path}`)
      if (!resp.ok) throw new Error('request failed')
      const payload = (await resp.json()) as T
      setState({ data: payload, loading: false, error: null })
    } catch {
      setState({ data: null, loading: false, error: `Unable to load ${path}` })
    }
  }, [apiBase, path])

  useEffect(() => {
    void load()
  }, [load])

  return [state, load]
}

function statusTone(value?: string): string {
  if (!value) return 'bg-zinc-800 text-zinc-300'
  if (value.includes('ok') || value.includes('approve') || value.includes('active')) return 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
  if (value.includes('hold') || value.includes('step')) return 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
  if (value.includes('freeze') || value.includes('fraud') || value.includes('degraded')) return 'bg-red-500/15 text-red-300 border border-red-500/30'
  return 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
}

function App() {
  const apiBase = useMemo(resolveApiBase, [])
  const initialRoute = ((window.location.hash.replace('#', '') || '/dashboard') as RouteKey)
  const [route, setRoute] = useState<RouteKey>(ROUTES.includes(initialRoute) ? initialRoute : '/dashboard')

  const [health, refreshHealth] = useApi<Record<string, unknown>>(apiBase, '/health')
  const [dashboard, refreshDashboard] = useApi<Record<string, unknown>>(apiBase, '/dashboard/overview')
  const [flow, refreshFlow] = useApi<{ items: Array<Record<string, unknown>> }>(apiBase, '/transaction-flow/recent')
  const [graph, refreshGraph] = useApi<Record<string, unknown>>(apiBase, '/graph-intelligence/network')
  const [graphOverview, refreshGraphOverview] = useApi<Record<string, unknown>>(apiBase, '/graph-intelligence/overview')
  const [modelLab, refreshModelLab] = useApi<Record<string, unknown>>(apiBase, '/model-lab/overview')
  const [modelOps, refreshModelOps] = useApi<Record<string, unknown>>(apiBase, '/model-ops/overview')
  const [cases, refreshCases] = useApi<{ items: Array<Record<string, unknown>> }>(apiBase, '/cases-audit/list')
  const [audits, refreshAudits] = useApi<{ items: Array<Record<string, unknown>> }>(apiBase, '/cases-audit/audits')
  const [rules, refreshRules] = useApi<{ rules: Record<string, unknown> }>(apiBase, '/rule-studio/rules')

  const [riskForm, setRiskForm] = useState({ amount: '950', channel: 'card', merchant: '', velocity: '2' })
  const [scoreResult, setScoreResult] = useState<ScorePayload | null>(null)
  const [runState, setRunState] = useState<string>('idle')

  useEffect(() => {
    window.location.hash = route
  }, [route])

  async function scoreTransaction() {
    setRunState('scoring')
    try {
      const payload = {
        transaction_id: `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        user_id: 'demo-user',
        amount: Number(riskForm.amount),
        merchant: riskForm.merchant || null,
        channel: riskForm.channel,
        timestamp: new Date().toISOString(),
        features: { velocity: Number(riskForm.velocity) },
      }
      const resp = await fetch(`${apiBase}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!resp.ok) throw new Error('failed')
      const result = (await resp.json()) as ScorePayload
      setScoreResult(result)
      await Promise.all([refreshFlow(), refreshDashboard(), refreshCases(), refreshAudits()])
      setRunState('done')
    } catch {
      setRunState('error')
    }
  }

  async function runSimulation() {
    setRunState('simulating')
    try {
      const resp = await fetch(`${apiBase}/simulation/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 50, fraud_ratio: 0.18, max_amount: 5000 }),
      })
      if (!resp.ok) throw new Error('failed')
      await Promise.all([refreshFlow(), refreshDashboard(), refreshGraph(), refreshGraphOverview()])
      setRunState('done')
    } catch {
      setRunState('error')
    }
  }

  async function performModelOps(action: 'promote' | 'rollback' | 'retrain-now') {
    setRunState(action)
    try {
      const resp = await fetch(`${apiBase}/model-ops/${action}`, { method: 'POST' })
      if (!resp.ok) throw new Error('failed')
      await Promise.all([refreshModelOps(), refreshAudits(), refreshDashboard()])
      setRunState('done')
    } catch {
      setRunState('error')
    }
  }

  async function applyRuleSimulation() {
    setRunState('rules')
    try {
      const payload = {
        risk_threshold: 0.6,
        velocity_limit: 5,
        high_risk_channels: ['wire', 'crypto', 'upi'],
      }
      const resp = await fetch(`${apiBase}/rule-studio/rules/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!resp.ok) throw new Error('failed')
      await refreshRules()
      setRunState('done')
    } catch {
      setRunState('error')
    }
  }

  const navButton = (item: RouteKey) => (
    <button
      key={item}
      type="button"
      onClick={() => setRoute(item)}
      className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${route === item ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-300/40' : 'bg-zinc-900/80 text-zinc-300 border border-zinc-700 hover:text-white'}`}
    >
      {item.replace('/', '')}
    </button>
  )

  const card = 'rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 shadow-lg shadow-black/20 motion-safe:animate-[fadeIn_.35s_ease]'

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 p-4 md:p-6">
        <header className="rounded-2xl border border-cyan-900/50 bg-gradient-to-r from-zinc-900 via-cyan-950/40 to-zinc-900 p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Fraud Detection Command Center</p>
              <h1 className="mt-1 text-2xl font-semibold md:text-3xl">Enterprise Layered Fraud Intelligence</h1>
              <p className="mt-2 text-sm text-zinc-400">UI routes, backend layers, governance, and simulation wired without retraining models.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void Promise.all([refreshHealth(), refreshDashboard(), refreshFlow(), refreshGraph(), refreshGraphOverview(), refreshModelLab(), refreshModelOps(), refreshCases(), refreshAudits(), refreshRules()])} className="rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-3 py-2 text-sm font-medium text-cyan-200">Refresh All</button>
              <span className={`rounded-lg px-3 py-2 text-xs ${statusTone((health.data?.status as string) || '')}`}>gateway: {(health.data?.status as string) || 'unknown'}</span>
            </div>
          </div>
          <nav className="mt-4 flex flex-wrap gap-2">{ROUTES.map(navButton)}</nav>
        </header>

        {route === '/dashboard' && (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'transactions_seen', value: (dashboard.data?.kpis as Record<string, unknown> | undefined)?.transactions_seen },
              { label: 'fraud_rate', value: (dashboard.data?.kpis as Record<string, unknown> | undefined)?.fraud_rate },
              { label: 'avg_score', value: (dashboard.data?.kpis as Record<string, unknown> | undefined)?.avg_score },
              { label: 'open_cases', value: (dashboard.data?.kpis as Record<string, unknown> | undefined)?.open_cases },
            ].map((item) => (
              <article key={item.label} className={card}>
                <p className="text-xs uppercase tracking-wide text-zinc-400">{item.label}</p>
                <p className="mt-3 text-3xl font-semibold text-cyan-200">{String(item.value ?? '--')}</p>
              </article>
            ))}
            <article className={`${card} md:col-span-2 xl:col-span-4`}>
              <p className="text-sm text-zinc-300">Decision distribution</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries((dashboard.data?.decision_counts as Record<string, number> | undefined) || {}).map(([key, value]) => (
                  <span key={key} className={`rounded-lg px-3 py-2 text-xs ${statusTone(key)}`}>{key}: {value}</span>
                ))}
              </div>
            </article>
          </section>
        )}

        {route === '/transaction-flow' && (
          <section className="grid gap-4 lg:grid-cols-3">
            <article className={`${card} lg:col-span-1`}>
              <h2 className="text-lg font-semibold">Live Transaction Scoring</h2>
              <div className="mt-3 grid gap-2 text-sm">
                <input className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2" placeholder="Amount" value={riskForm.amount} onChange={(e) => setRiskForm((p) => ({ ...p, amount: e.target.value }))} />
                <select className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2" value={riskForm.channel} onChange={(e) => setRiskForm((p) => ({ ...p, channel: e.target.value }))}>
                  {['card', 'wire', 'crypto', 'ach', 'upi'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2" placeholder="Merchant" value={riskForm.merchant} onChange={(e) => setRiskForm((p) => ({ ...p, merchant: e.target.value }))} />
                <input className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2" placeholder="Velocity" value={riskForm.velocity} onChange={(e) => setRiskForm((p) => ({ ...p, velocity: e.target.value }))} />
                <button type="button" onClick={() => void scoreTransaction()} className="rounded-lg bg-cyan-500/20 px-3 py-2 font-medium text-cyan-200">Score Transaction</button>
              </div>
              {scoreResult && (
                <div className="mt-4 grid gap-2 text-sm">
                  <span className={`inline-flex w-fit rounded-md px-2 py-1 ${statusTone(scoreResult.label)}`}>{scoreResult.label}</span>
                  <p>score: <strong>{Math.round(scoreResult.score * 100)}%</strong></p>
                  <p>decision: <strong>{scoreResult.decision}</strong></p>
                  <p className="text-zinc-400">{scoreResult.reasons.join(', ')}</p>
                </div>
              )}
            </article>
            <article className={`${card} lg:col-span-2`}>
              <h2 className="text-lg font-semibold">Recent Decisions</h2>
              <div className="mt-3 grid gap-2">
                {(flow.data?.items || []).slice(0, 14).map((item) => (
                  <div key={String(item.transaction_id)} className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 text-xs md:grid-cols-6 md:items-center">
                    <p className="truncate md:col-span-2">{String(item.transaction_id || 'tx')}</p>
                    <p>{String(item.channel || '--')}</p>
                    <p>{Math.round(Number(item.score || 0) * 100)}%</p>
                    <span className={`w-fit rounded px-2 py-1 ${statusTone(String(item.label || ''))}`}>{String(item.label || '--')}</span>
                    <span className={`w-fit rounded px-2 py-1 ${statusTone(String(item.decision || ''))}`}>{String(item.decision || '--')}</span>
                  </div>
                ))}
              </div>
            </article>
          </section>
        )}

        {route === '/simulation-lab' && (
          <section className="grid gap-4 lg:grid-cols-3">
            <article className={card}>
              <h2 className="text-lg font-semibold">Simulation Lab</h2>
              <p className="mt-2 text-sm text-zinc-400">Inject fraud archetypes, update flow, and sync graph.</p>
              <button type="button" onClick={() => void runSimulation()} className="mt-4 rounded-lg bg-violet-500/20 px-3 py-2 text-sm font-medium text-violet-200">Run 50-event Simulation</button>
              <p className="mt-3 text-xs text-zinc-500">state: {runState}</p>
            </article>
            <article className={`${card} lg:col-span-2`}>
              <h2 className="text-lg font-semibold">Simulation Impact</h2>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {[
                  { label: 'nodes', value: graphOverview.data?.nodes },
                  { label: 'edges', value: graphOverview.data?.edges },
                  { label: 'high_risk_nodes', value: graphOverview.data?.high_risk_nodes },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <p className="text-xs text-zinc-400">{item.label}</p>
                    <p className="mt-2 text-2xl font-semibold text-violet-200">{String(item.value ?? '--')}</p>
                  </div>
                ))}
              </div>
            </article>
          </section>
        )}

        {route === '/graph-intelligence' && (
          <section className="grid gap-4">
            <article className={card}>
              <h2 className="text-lg font-semibold">Graph Intelligence</h2>
              <p className="mt-1 text-sm text-zinc-400">Network size, suspicious rings, and high-risk entities.</p>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm">nodes: {String(graphOverview.data?.nodes ?? '--')}</div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm">edges: {String(graphOverview.data?.edges ?? '--')}</div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm">mule signals: {String(graphOverview.data?.mule_ring_signals ?? '--')}</div>
              </div>
              <div className="mt-4 max-h-80 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs">
                <p className="mb-2 text-zinc-400">rings</p>
                {(((graph.data?.rings as Array<Record<string, unknown>> | undefined) || [])).map((ring) => (
                  <div key={String(ring.id)} className="mb-2 rounded border border-zinc-700 p-2">
                    <p>{String(ring.id)} · risk {String(ring.risk)}</p>
                    <p className="text-zinc-500">members: {((ring.members as string[] | undefined) || []).join(', ') || 'n/a'}</p>
                  </div>
                ))}
              </div>
            </article>
          </section>
        )}

        {route === '/model-lab' && (
          <section className="grid gap-4 lg:grid-cols-3">
            <article className={`${card} lg:col-span-1`}>
              <h2 className="text-lg font-semibold">Model Lab</h2>
              <p className="mt-2 text-sm text-zinc-400">Champion: {String((modelLab.data?.model as Record<string, unknown> | undefined)?.champion ?? '--')}</p>
              <p className="text-sm text-zinc-400">PR-AUC: {String((modelLab.data?.model as Record<string, unknown> | undefined)?.pr_auc ?? '--')}</p>
            </article>
            <article className={`${card} lg:col-span-2`}>
              <h3 className="text-base font-semibold">Feature Stats</h3>
              <div className="mt-3 grid gap-2">
                {((modelLab.data?.feature_stats as Array<Record<string, unknown>> | undefined) || []).map((item) => (
                  <div key={String(item.feature)} className="grid grid-cols-3 rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-xs">
                    <p>{String(item.feature)}</p><p>mean {String(item.mean)}</p><p>var {String(item.variance)}</p>
                  </div>
                ))}
              </div>
            </article>
            <article className={`${card} lg:col-span-3`}>
              <h3 className="text-base font-semibold">Cumulative Accuracy Curve</h3>
              <div className="mt-3 grid gap-2 md:grid-cols-5">
                {((modelLab.data?.accuracy_curve as Array<Record<string, unknown>> | undefined) || []).map((pt) => (
                  <div key={String(pt.x)} className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-xs">
                    <p>x: {String(pt.x)}</p>
                    <p>prec: {String(pt.precision)}</p>
                    <p>rec: {String(pt.recall)}</p>
                  </div>
                ))}
              </div>
            </article>
          </section>
        )}

        {route === '/model-ops' && (
          <section className="grid gap-4 lg:grid-cols-12">
            <article className={`${card} lg:col-span-12`}>
              <h2 className="text-lg font-semibold">Model Ops</h2>
              <p className="mt-1 text-sm text-zinc-400">Top retrain cards, left drift metrics, center champion/challenger, right artifacts, bottom history.</p>
            </article>
            <article className={`${card} lg:col-span-3`}>
              <p className="text-xs uppercase text-zinc-400">Retrain cadence</p>
              <p className="mt-2 text-2xl font-semibold text-cyan-200">7 days</p>
              <p className="mt-1 text-xs text-zinc-500">next: {String((modelOps.data?.schedule as Record<string, unknown> | undefined)?.next_retrain_at ?? '--')}</p>
              <p className="mt-1 text-xs text-zinc-500">countdown(s): {String((modelOps.data?.schedule as Record<string, unknown> | undefined)?.countdown_seconds ?? '--')}</p>
            </article>
            <article className={`${card} lg:col-span-3`}>
              <p className="text-xs uppercase text-zinc-400">Drift metrics</p>
              {Object.entries((modelOps.data?.drift as Record<string, unknown> | undefined) || {}).map(([k, v]) => <p key={k} className="mt-2 text-sm text-zinc-200">{k}: {String(v)}</p>)}
            </article>
            <article className={`${card} lg:col-span-4`}>
              <p className="text-xs uppercase text-zinc-400">Champion vs Challenger</p>
              <div className="mt-2 grid gap-2 text-sm">
                <p>champion: {String((modelOps.data?.champion as Record<string, unknown> | undefined)?.version ?? '--')}</p>
                <p>challenger: {String((modelOps.data?.challenger as Record<string, unknown> | undefined)?.version ?? '--')}</p>
                <p>adaptive: {String((modelOps.data?.adaptive_learning as Record<string, unknown> | undefined)?.policy ?? '--')}</p>
              </div>
            </article>
            <article className={`${card} lg:col-span-2`}>
              <p className="text-xs uppercase text-zinc-400">Actions</p>
              <div className="mt-2 grid gap-2">
                <button type="button" onClick={() => void performModelOps('retrain-now')} className="rounded-lg border border-violet-400/40 bg-violet-500/15 px-3 py-2 text-xs text-violet-200">Retrain Now</button>
                <button type="button" onClick={() => void performModelOps('promote')} className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-xs text-emerald-200">Promote</button>
                <button type="button" onClick={() => void performModelOps('rollback')} className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-xs text-amber-200">Rollback</button>
              </div>
            </article>
            <article className={`${card} lg:col-span-12`}>
              <p className="text-xs uppercase text-zinc-400">Retrain history</p>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {((modelOps.data?.history as Array<Record<string, unknown>> | undefined) || []).map((item) => (
                  <div key={String(item.id)} className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-xs">
                    <p>{String(item.id)}</p>
                    <p>{String(item.candidate_version)}</p>
                    <p>pr_auc: {String(item.challenger_pr_auc)}</p>
                    <span className={`inline-flex rounded px-2 py-1 ${statusTone(String(item.promoted ? 'active' : 'shadow'))}`}>{item.promoted ? 'promoted' : 'shadow'}</span>
                  </div>
                ))}
              </div>
            </article>
          </section>
        )}

        {route === '/cases-audit' && (
          <section className="grid gap-4 lg:grid-cols-2">
            <article className={card}>
              <h2 className="text-lg font-semibold">Cases</h2>
              <div className="mt-3 grid gap-2">
                {(cases.data?.items || []).map((item) => (
                  <div key={String(item.id)} className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-xs">
                    <p>{String(item.id)}</p>
                    <p>{String(item.status)} · {String(item.severity)}</p>
                    <p className="text-zinc-500">owner: {String(item.owner)}</p>
                  </div>
                ))}
              </div>
            </article>
            <article className={card}>
              <h2 className="text-lg font-semibold">Audit Trail</h2>
              <div className="mt-3 grid gap-2">
                {(audits.data?.items || []).slice(0, 20).map((item) => (
                  <div key={String(item.id)} className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-xs">
                    <p>{String(item.actor)} · {String(item.action)}</p>
                    <p className="text-zinc-500">{String(item.target)} @ {String(item.timestamp)}</p>
                  </div>
                ))}
              </div>
            </article>
          </section>
        )}

        {route === '/rule-studio' && (
          <section className="grid gap-4 lg:grid-cols-2">
            <article className={card}>
              <h2 className="text-lg font-semibold">Rule Studio</h2>
              <p className="mt-2 text-sm text-zinc-400">Current simulation rules:</p>
              <pre className="mt-3 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">{JSON.stringify(rules.data?.rules || {}, null, 2)}</pre>
              <button type="button" onClick={() => void applyRuleSimulation()} className="mt-3 rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-3 py-2 text-xs text-cyan-200">Apply Simulated Rule Tuning</button>
            </article>
            <article className={card}>
              <h3 className="text-base font-semibold">Governance Notes</h3>
              <ul className="mt-3 grid gap-2 text-sm text-zinc-400">
                <li>• Rule changes here are non-destructive simulation updates.</li>
                <li>• Production scoring remains stable and auditable.</li>
                <li>• Use model-ops for promote/rollback lifecycle controls.</li>
              </ul>
            </article>
          </section>
        )}

        {(health.error || dashboard.error || flow.error || graph.error || modelLab.error || modelOps.error || cases.error || audits.error || rules.error) && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            {health.error || dashboard.error || flow.error || graph.error || modelLab.error || modelOps.error || cases.error || audits.error || rules.error}
          </p>
        )}
      </div>
    </div>
  )
}

export default App
