// ---------------------------------------------------------------------------
// DashboardPage — KPIs, decision distribution, graph + model-ops summary.
// ---------------------------------------------------------------------------

import { useRef, useState, useEffect } from 'react'
import { KpiCard } from '../components/ui/KpiCard'
import { Panel } from '../components/ui/Panel'
import { AnimatedBar } from '../components/ui/AnimatedBar'
import { StatusDot } from '../components/ui/StatusDot'
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
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const fetchStartRef = useRef<number>(0)

  useEffect(() => {
    if (dash.loading) {
      fetchStartRef.current = Date.now()
    } else if (dash.data) {
      setLatencyMs(Date.now() - fetchStartRef.current)
    }
  }, [dash.loading, dash.data])

  const kpis = dash.data?.kpis
  const decisionCounts = dash.data?.decision_counts ?? {}
  const graphData = dash.data?.graph as Record<string, number> | undefined
  const modelOps = dash.data?.model_ops
  const freezeCount = decisionCounts['freeze'] ?? 0

  const totalDecisions = Object.values(decisionCounts).reduce((a, b) => a + b, 0)
  const fraudRatePct = kpis ? kpis.fraud_rate * 100 : 0

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Command Dashboard"
        subtitle="Live SOC operations, threat intelligence, and system health"
        action={
          <div className="flex items-center gap-2">
            {latencyMs !== null && (
              <span className="rounded-md border border-zinc-700 bg-zinc-800/60 px-2.5 py-1 text-[10px] tabular-nums text-zinc-400">
                ⏱ {latencyMs}ms • synced just now
              </span>
            )}
            <button
              type="button"
              onClick={() => void refreshDash()}
              className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-cyan-500/50 hover:text-cyan-200"
            >
              ↻ Sync latest decisions
            </button>
          </div>
        }
      />

      {/* 1. HEALTH AND GATEWAY STATUS (Top) */}
      <Panel className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between py-3 px-4">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-zinc-300">Environment Health</h3>
          <div className="flex items-center gap-2">
            <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-zinc-400 border border-zinc-700">Demo Tier</span>
            <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-violet-300 border border-violet-500/30">Stable</span>
          </div>
        </div>
        {health.loading ? (
             <div className="h-6 w-48 animate-pulse rounded bg-zinc-800/50" />
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

      {/* 2. FRAUD SPIKE KPIs */}
      {dash.loading ? (
         <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5 animate-[shimmer_2s_infinite] bg-[linear-gradient(to_right,#00000000,#ffffff0a,#00000000)] bg-size-[400%_100%] rounded-xl">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-28 rounded-xl bg-zinc-900/50 border border-zinc-800/50" />
            ))}
         </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard
              label="Global Volume"
              value={kpis?.transactions_seen}
              accent="cyan"
              delay={0}
            />
            <KpiCard
              label="Active Fraud Rate"
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
              label="Unassigned Cases"
              value={kpis?.open_cases}
              accent="violet"
              delay={300}
            />
            <KpiCard
              label="Accounts Frozen"
              value={freezeCount}
              accent="red"
              delay={400}
            />
          </div>

          {/* Fraud rate mini bar */}
          {kpis && (
            <div className="flex items-center gap-3 rounded-xl border border-red-900/30 bg-red-950/20 px-4 py-3">
              <span className="w-24 shrink-0 text-xs font-medium text-red-400">Threat Level</span>
              <div className="flex-1">
                  <AnimatedBar value={fraudRatePct} max={10} color="red" height="h-2" delay={400} />
              </div>
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-red-400">
                {fraudRatePct.toFixed(1)}%
              </span>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* 3. GRAPH MOVEMENT */}
            <Panel glow="cyan" className="flex flex-col">
              <h3 className="mb-3 text-sm font-semibold text-zinc-300">Entity Topology & Signals</h3>
              <div className="grid grid-cols-2 gap-3 grow content-start">
                {(['nodes', 'edges', 'high_risk_nodes', 'mule_ring_signals'] as const).map((key) => (
                  <div key={key} className="rounded-lg border border-cyan-900/20 bg-zinc-950/60 p-4 transition-colors hover:border-cyan-500/30">
                    <p className="text-[11px] text-zinc-500 uppercase tracking-widest">{key.replace(/_/g, ' ')}</p>
                    <div className="mt-2 flex items-baseline gap-2">
                       <p className={`text-2xl font-bold tracking-tight tabular-nums ${key.includes('mule') || key.includes('risk') ? 'text-red-400' : 'text-cyan-300'}`}>
                         {graphData?.[key] ?? '—'}
                       </p>
                       {graphData?.[key] && <span className="text-xs text-emerald-400">↑</span>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex gap-3">
                 <button onClick={() => { window.location.hash = '/graph-intelligence' }} className="flex-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 py-2.5 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20">
                   Explore Graph Network
                 </button>
                 <button onClick={() => { window.location.hash = '/cases-audit' }} className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 py-2.5 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-700">
                   Isolate Mule Rings
                 </button>
              </div>
            </Panel>

            {/* 4. FREEZE QUEUE / DECISION DISTRIBUTION & MODEL DRIFT */}
            <div className="flex flex-col gap-6">
                <Panel className="flex-1">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-zinc-300">Decision Outcome Distribution</h3>
                    <button onClick={() => { window.location.hash = '/transaction-flow' }} className="text-xs text-zinc-500 hover:text-zinc-300 decoration-1 underline-offset-2 hover:underline transition-colors">View recent →</button>
                  </div>
                  {Object.keys(decisionCounts).length === 0 ? (
                    <div className="flex h-24 items-center justify-center rounded-lg border border-zinc-800 border-dashed bg-zinc-950"><p className="text-xs text-zinc-600">No decisions scored yet.</p></div>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2 mb-4 mt-2">
                        {Object.entries(decisionCounts).map(([key, count]) => (
                          <div key={key} className={`flex flex-1 flex-col items-center gap-1.5 rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3 transition-colors hover:border-zinc-600 ${key === 'freeze' ? 'ring-1 ring-red-500/30 bg-red-950/10' : ''}`}>
                            <span className={`text-[10px] uppercase tracking-wider ${key === 'freeze' ? 'text-red-400 font-medium' : 'text-zinc-500'}`}>{key.replace(/_/g, ' ')}</span>
                            <span className="text-xl font-semibold tabular-nums text-zinc-100">{count}</span>
                          </div>
                        ))}
                      </div>
                      {/* Mini stacked decision bar */}
                      {totalDecisions > 0 && (
                        <div className="h-2 w-full overflow-hidden rounded-full flex shadow-inner">
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
                    </>
                  )}
                </Panel>

                <Panel glow="violet">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-zinc-300">Model Active State</h3>
                    <span className="rounded bg-violet-500/20 px-2 py-0.5 text-[9px] font-medium tracking-wide text-violet-300 border border-violet-500/30 animate-pulse">Monitoring</span>
                  </div>
                  <div className="grid gap-3 mb-4">
                    <div className="flex justify-between items-center rounded-lg border border-violet-900/30 bg-zinc-950/60 px-4 py-3">
                      <div>
                         <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Champion</p>
                         <p className="text-sm font-medium text-zinc-200 mt-1">{String(modelOps?.champion?.version ?? 'v2.4.1-rc')}</p>
                      </div>
                      <div className="text-right">
                         <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Confidence</p>
                         <p className="text-sm font-medium text-emerald-400 mt-1">99.2%</p>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => { window.location.hash = '/model-ops' }} className="w-full rounded-lg border border-violet-500/30 bg-violet-500/10 py-2.5 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/20">
                    Inspect Model Drift
                  </button>
                </Panel>
            </div>
          </div>
        </>
      )}

      <ErrorBanner message={dash.error} />
    </div>
  )
}
