// ---------------------------------------------------------------------------
// GraphIntelligencePage — network overview, high-risk nodes, and ring clusters.
// ---------------------------------------------------------------------------

import { Panel } from '../components/ui/Panel'
import { KpiCard } from '../components/ui/KpiCard'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { SectionHeader } from '../components/ui/SectionHeader'
import { EmptyState } from '../components/ui/EmptyState'
import { FraudGraphCanvas } from '../components/ui/FraudGraphCanvas'
import { useApi } from '../hooks/useApi'
import { usePresentation } from '../hooks/usePresentation'
import type { GraphNetworkResponse, GraphOverviewResponse } from '../types/api'

interface GraphIntelligencePageProps {
  apiBase: string
}

function riskColor(risk: number): string {
  if (risk >= 0.8) return 'text-red-400'
  if (risk >= 0.6) return 'text-orange-400'
  if (risk >= 0.4) return 'text-amber-400'
  return 'text-emerald-400'
}

export function GraphIntelligencePage({ apiBase }: GraphIntelligencePageProps) {
  const [overview, refreshOverview] = useApi<GraphOverviewResponse>(apiBase, '/graph-intelligence/overview')
  const [network, refreshNetwork] = useApi<GraphNetworkResponse>(apiBase, '/graph-intelligence/network')
  const presentation = usePresentation()

  const rings = network.data?.rings ?? []
  const nodes = network.data?.nodes ?? []
  const highRiskNodes = nodes.filter((n) => n.risk >= 0.7).slice(0, 20)

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Graph Intelligence"
        subtitle="Directed sender → receiver transaction intelligence with mule-ring and sink flow visibility"
        action={
          <button
            type="button"
            onClick={() => { void refreshOverview(); void refreshNetwork() }}
            className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-300 hover:text-cyan-200"
          >
            ↻ Refresh
          </button>
        }
      />

      {/* KPI row */}
      {overview.loading ? (
        <div className="flex justify-center py-10"><Spinner size="lg" /></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Total Nodes" value={overview.data?.nodes} accent="cyan" />
          <KpiCard label="Total Edges" value={overview.data?.edges} accent="cyan" />
          <KpiCard label="High-Risk Nodes" value={overview.data?.high_risk_nodes} accent="red" />
          <KpiCard label="Mule Ring Signals" value={overview.data?.mule_ring_signals} accent="violet" />
        </div>
      )}

      {/* Directed transaction graph */}
      <Panel glow="cyan">
        <h3 className="mb-3 text-base font-semibold text-zinc-100">Transaction Flow Graph</h3>
        <p className="mb-3 text-xs text-zinc-500">
          Each edge is a real transfer with direction, amount and risk. Click a node for account summary or click an edge for transaction details.
        </p>
        {network.loading ? (
          <div className="flex h-[420px] items-center justify-center"><Spinner size="lg" /></div>
        ) : (
          <FraudGraphCanvas nodes={nodes} edges={network.data?.edges ?? []} height={420} frozen={presentation} />
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Ring clusters */}
        <Panel glow="violet">
          <h3 className="mb-4 text-base font-semibold text-zinc-100">Suspicious Ring Clusters</h3>
          {network.loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : rings.length === 0 ? (
            <EmptyState message="No ring clusters detected yet — run a simulation to populate" />
          ) : (
            <div className="space-y-3">
              {rings.map((ring) => (
                <div key={ring.id} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-zinc-100">{ring.id}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500">risk</span>
                      <span className={`text-sm font-bold ${riskColor(ring.risk)}`}>
                        {(ring.risk * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  <div className="mt-3">
                    <p className="mb-2 text-[10px] text-zinc-600">Members ({ring.members.length})</p>
                    <div className="flex flex-wrap gap-1">
                      {ring.members.slice(0, 8).map((m) => (
                        <span key={m} className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                          {m}
                        </span>
                      ))}
                      {ring.members.length > 8 && (
                        <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-600">
                          +{ring.members.length - 8} more
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Risk bar */}
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className={`h-full rounded-full transition-all ${ring.risk >= 0.8 ? 'bg-red-400' : ring.risk >= 0.6 ? 'bg-orange-400' : 'bg-amber-400'}`}
                      style={{ width: `${ring.risk * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          <ErrorBanner message={network.error} />
        </Panel>

        {/* High-risk node list */}
        <Panel glow="red">
          <h3 className="mb-4 text-base font-semibold text-zinc-100">High-Risk Accounts</h3>
          {network.loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : highRiskNodes.length === 0 ? (
            <EmptyState message="No high-risk nodes detected yet" />
          ) : (
            <div className="space-y-1.5 max-h-[480px] overflow-y-auto pr-1">
              {highRiskNodes.map((node) => (
                <div
                  key={node.id}
                  className="flex items-center gap-3 rounded-lg border border-zinc-800/60 bg-zinc-950/60 px-3 py-2"
                >
                  <div
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${riskColor(node.risk).replace('text-', 'bg-')}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs text-zinc-300">{node.id}</p>
                    <p className="text-[10px] text-zinc-600">{node.label}</p>
                  </div>
                  <div className="text-right">
                    <span className={`text-sm font-bold tabular-nums ${riskColor(node.risk)}`}>
                      {(node.risk * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <ErrorBanner message={overview.error} />
    </div>
  )
}
