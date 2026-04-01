// ---------------------------------------------------------------------------
// DashboardPage — KPIs, decision distribution, graph + model-ops summary.
// ---------------------------------------------------------------------------

import { KpiCard } from '../components/ui/KpiCard'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { SectionHeader } from '../components/ui/SectionHeader'
import { useApi } from '../hooks/useApi'
import type { DashboardResponse, GatewayHealthResponse } from '../types/api'

interface DashboardPageProps {
  apiBase: string
}

export function DashboardPage({ apiBase }: DashboardPageProps) {
  const [dash, refreshDash] = useApi<DashboardResponse>(apiBase, '/dashboard/overview')
  const [health] = useApi<GatewayHealthResponse>(apiBase, '/health')

  const kpis = dash.data?.kpis
  const decisionCounts = dash.data?.decision_counts ?? {}
  const graphData = dash.data?.graph as Record<string, number> | undefined
  const modelOps = dash.data?.model_ops

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
            />
            <KpiCard
              label="Fraud Rate"
              value={kpis ? `${(kpis.fraud_rate * 100).toFixed(1)}%` : null}
              accent="red"
            />
            <KpiCard
              label="Avg Risk Score"
              value={kpis ? `${(kpis.avg_score * 100).toFixed(1)}%` : null}
              accent="amber"
            />
            <KpiCard
              label="Open Cases"
              value={kpis?.open_cases}
              accent="violet"
            />
          </div>

          {/* Decision distribution */}
          <Panel>
            <h3 className="mb-3 text-sm font-semibold text-zinc-300">Decision Distribution</h3>
            {Object.keys(decisionCounts).length === 0 ? (
              <p className="text-xs text-zinc-600">No decisions yet — score a transaction first.</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {Object.entries(decisionCounts).map(([key, count]) => (
                  <div key={key} className="flex flex-col items-center gap-1.5">
                    <Badge value={key} size="md" />
                    <span className="text-2xl font-semibold tabular-nums text-zinc-100">{count}</span>
                  </div>
                ))}
              </div>
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
              <div className="flex flex-wrap gap-2">
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
                    <div key={name} className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500">{name}</span>
                      <Badge value={status} />
                    </div>
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
