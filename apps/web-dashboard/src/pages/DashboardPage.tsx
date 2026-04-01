// ---------------------------------------------------------------------------
// DashboardPage — KPIs, decision distribution, graph + model-ops summary.
// ---------------------------------------------------------------------------

import { KpiCard } from '../components/ui/KpiCard'
import { Panel } from '../components/ui/Panel'
import { AnimatedBar } from '../components/ui/AnimatedBar'
import { StatusDot } from '../components/ui/StatusDot'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { SectionHeader } from '../components/ui/SectionHeader'
import { useApi } from '../hooks/useApi'
import type { DashboardResponse, GatewayHealthResponse } from '../types/api'

interface DashboardPageProps {
  apiBase: string
}

const DECISION_COLORS: Record<string, string> = {
  approve: 'bg-emerald-500/70',
  step_up_auth: 'bg-amber-500/70',
  hold: 'bg-orange-500/70',
  freeze: 'bg-red-500/70',
}

export function DashboardPage({ apiBase }: DashboardPageProps) {
  const [dash, refreshDash] = useApi<DashboardResponse>(apiBase, '/dashboard/overview')
  const [health] = useApi<GatewayHealthResponse>(apiBase, '/health')

  const kpis = dash.data?.kpis
  const decisionCounts = dash.data?.decision_counts ?? {}
  const graphData = dash.data?.graph as Record<string, number> | undefined
  const modelOps = dash.data?.model_ops

  const totalDecisions = Object.values(decisionCounts).reduce((a, b) => a + b, 0)
  const fraudRatePct = kpis ? kpis.fraud_rate * 100 : 0

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Command Dashboard"
        subtitle="Live KPIs, decision distribution, and service health"
        action={
          <button
            type="button"
            onClick={() => void refreshDash()}
            className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-300 hover:text-cyan-200"
          >
            ↻ Refresh
          </button>
        }
      />

      {/* KPI row */}
      {dash.loading ? (
        <div className="flex justify-center py-10"><Spinner size="lg" /></div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Transactions Seen"
              value={kpis?.transactions_seen}
              accent="cyan"
              delay={0}
            />
            <KpiCard
              label="Fraud Rate"
              value={kpis ? `${(kpis.fraud_rate * 100).toFixed(1)}%` : null}
              accent="red"
              delay={100}
            />
            <KpiCard
              label="Avg Risk Score"
              value={kpis ? `${(kpis.avg_score * 100).toFixed(1)}%` : null}
              accent="amber"
              delay={200}
            />
            <KpiCard
              label="Open Cases"
              value={kpis?.open_cases}
              accent="violet"
              delay={300}
            />
          </div>

          {/* Fraud rate mini bar */}
          {kpis && (
            <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
              <span className="w-24 shrink-0 text-xs text-zinc-500">Fraud rate</span>
              <AnimatedBar value={fraudRatePct} max={100} color="red" height="h-2" delay={400} />
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-red-300">
                {fraudRatePct.toFixed(1)}%
              </span>
            </div>
          )}

          {/* Decision distribution */}
          <Panel>
            <h3 className="mb-3 text-sm font-semibold text-zinc-300">Decision Distribution</h3>
            {Object.keys(decisionCounts).length === 0 ? (
              <p className="text-xs text-zinc-600">No decisions yet — score a transaction first.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-3 mb-4">
                  {Object.entries(decisionCounts).map(([key, count]) => (
                    <div key={key} className="flex flex-col items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                      <span className="text-[10px] uppercase tracking-widest text-zinc-500">{key.replace(/_/g, ' ')}</span>
                      <span className="text-2xl font-semibold tabular-nums text-zinc-100">{count}</span>
                    </div>
                  ))}
                </div>
                {/* Mini stacked decision bar */}
                {totalDecisions > 0 && (
                  <div className="h-4 w-full overflow-hidden rounded-full flex">
                    {Object.entries(decisionCounts).map(([key, count]) => (
                      <div
                        key={key}
                        className={`h-full ${DECISION_COLORS[key] ?? 'bg-zinc-600'} transition-all`}
                        style={{ width: `${(count / totalDecisions) * 100}%` }}
                        title={`${key}: ${count}`}
                      />
                    ))}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-zinc-600">
                  {Object.keys(DECISION_COLORS).map((key) => (
                    <span key={key} className="flex items-center gap-1">
                      <span className={`inline-block h-2 w-3 rounded-sm ${DECISION_COLORS[key]}`} />
                      {key.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </>
            )}
          </Panel>

          {/* Graph + Model ops side by side */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel glow="cyan">
              <h3 className="mb-3 text-sm font-semibold text-zinc-300">Graph Overview</h3>
              <div className="grid grid-cols-2 gap-3">
                {(['nodes', 'edges', 'high_risk_nodes', 'mule_ring_signals'] as const).map((key) => (
                  <div key={key} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                    <p className="text-xs text-zinc-500">{key.replace(/_/g, ' ')}</p>
                    <p className="mt-1 text-xl font-semibold text-cyan-200">
                      {graphData?.[key] ?? '—'}
                    </p>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel glow="violet">
              <h3 className="mb-3 text-sm font-semibold text-zinc-300">Model Ops Snapshot</h3>
              <div className="grid gap-2 text-sm">
                <div className="flex justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                  <span className="text-zinc-500">Champion</span>
                  <span className="text-zinc-100 font-medium truncate max-w-[55%] text-right">
                    {String(modelOps?.champion?.version ?? '—')}
                  </span>
                </div>
                <div className="flex justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                  <span className="text-zinc-500">Challenger</span>
                  <span className="text-zinc-100 font-medium truncate max-w-[55%] text-right">
                    {String(modelOps?.challenger?.version ?? '—')}
                  </span>
                </div>
                <div className="flex justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                  <span className="text-zinc-500">Next Retrain</span>
                  <span className="text-zinc-100 text-xs">
                    {modelOps?.next_retrain_at
                      ? new Date(modelOps.next_retrain_at).toLocaleDateString()
                      : '—'}
                  </span>
                </div>
              </div>
            </Panel>
          </div>

          {/* Service health */}
          <Panel>
            <h3 className="mb-3 text-sm font-semibold text-zinc-300">Service Health</h3>
            {health.loading ? (
              <Spinner size="sm" />
            ) : (
              <div className="flex flex-wrap gap-4">
                {health.data &&
                  (
                    [
                      ['gateway', health.data.status],
                      ['inference', health.data.inference_status],
                      ['scheduler', health.data.scheduler_status],
                      ['simulation', health.data.simulation_status],
                      ['graph', health.data.graph_status],
                      ['audit', health.data.audit_status],
                    ] as [string, string][]
                  ).map(([name, status]) => (
                    <StatusDot key={name} status={status} label={name} />
                  ))}
              </div>
            )}
          </Panel>
        </>
      )}

      <ErrorBanner message={dash.error} />
    </div>
  )
}
