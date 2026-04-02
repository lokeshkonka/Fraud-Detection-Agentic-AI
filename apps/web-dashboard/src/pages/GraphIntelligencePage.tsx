// ---------------------------------------------------------------------------
// GraphIntelligencePage — operational network overview with investigation tools.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { KpiCard } from '../components/ui/KpiCard'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { SectionHeader } from '../components/ui/SectionHeader'
import { EmptyState } from '../components/ui/EmptyState'
import { FraudGraphCanvas } from '../components/ui/FraudGraphCanvas'
import { useApi } from '../hooks/useApi'
import { usePresentation } from '../hooks/usePresentation'
import { useToast } from '../hooks/useToast'
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
  const addToast = useToast()
  
  const [demoState, setDemoState] = useState<'idle' | 'playing'>('idle')

  const rings = network.data?.rings ?? []
  const nodes = network.data?.nodes ?? []
  const highRiskNodes = nodes.filter((n) => n.risk >= 0.7).slice(0, 20)

  const handleReplayClick = () => {
    setDemoState('playing')
    addToast('Executing timed illumination: Victim → Mule → Sink', 'info')
    setTimeout(() => setDemoState('idle'), 6000)
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Topology Intelligence"
        subtitle="Operational graph analysis: track value transfer paths, isolate rings, and freeze bad actors"
        action={
          <div className="flex gap-2">
            <button
              onClick={handleReplayClick}
              className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-300 hover:bg-violet-500/20 transition-colors shadow-[0_0_10px_rgba(139,92,246,0.1)] hover:shadow-[0_0_15px_rgba(139,92,246,0.2)]"
            >
              ▶ Replay suspected fraud paths
            </button>
            <button
              type="button"
              onClick={() => { void refreshOverview(); void refreshNetwork() }}
              className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-300 hover:text-cyan-200 transition-colors"
            >
              ↻ Sync graph state
            </button>
          </div>
        }
      />

      {/* KPI row */}
      {overview.loading ? (
         <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-[shimmer_2s_infinite] bg-[linear-gradient(to_right,#00000000,#ffffff0a,#00000000)] bg-[length:400%_100%] rounded-xl">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 rounded-xl bg-zinc-900/50 border border-zinc-800/50" />
            ))}
         </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Nodes Catalogued" value={overview.data?.nodes} accent="cyan" />
          <KpiCard label="Value Edges" value={overview.data?.edges} accent="cyan" />
          <KpiCard label="Critical Risk Entities" value={overview.data?.high_risk_nodes} accent="red" />
          <KpiCard label="Ring Structures Detected" value={overview.data?.mule_ring_signals} accent="violet" />
        </div>
      )}

      {/* Directed transaction graph */}
      <Panel glow="cyan" className="p-0 overflow-hidden relative">
        <div className="absolute top-4 left-4 z-10 w-full pr-8">
           <div className="flex items-end justify-between">
              <div>
                <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                   Entity Relationship Visualization
                   {demoState === 'playing' && <span className="flex h-2 w-2 relative ml-1"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span></span>}
                </h3>
                <p className="text-xs text-zinc-400 mt-1">Scroll to zoom, drag to pan. Edges map value transfer. Highlight nodes to trace immediate flow.</p>
              </div>
           </div>
        </div>
        
        {network.loading ? (
          <div className="flex h-[540px] items-center justify-center"><Spinner size="lg" /></div>
        ) : (
          <FraudGraphCanvas nodes={nodes} edges={network.data?.edges ?? []} height={540} frozen={presentation} demoActive={demoState === 'playing'} />
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Ring clusters */}
        <Panel glow="violet">
          <div className="flex items-center justify-between mb-4">
             <h3 className="text-base font-semibold text-zinc-100">Coordinated Mule Clusters</h3>
             <span className="text-[10px] uppercase font-semibold text-violet-400 bg-violet-400/10 px-2 py-0.5 rounded tracking-wider">{rings.length} found</span>
          </div>
          {network.loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : rings.length === 0 ? (
            <EmptyState message="No ring clusters detected yet — run a simulation to populate" />
          ) : (
            <div className="space-y-3">
              {rings.map((ring) => (
                <div key={ring.id} className="group rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 transition-all hover:bg-zinc-900/80 hover:border-zinc-700 cursor-pointer">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-zinc-200 group-hover:text-violet-300 transition-colors">{ring.id}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500 font-medium tracking-wide uppercase">Confidence</span>
                      <span className={`text-sm font-bold bg-zinc-950 px-2 rounded tabular-nums ${riskColor(ring.risk)} shadow-inner`}>
                        {(ring.risk * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  <div className="mt-3">
                    <p className="mb-2 text-[10px] text-zinc-600 font-semibold tracking-wider uppercase">Associated Entities ({ring.members.length})</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ring.members.slice(0, 8).map((m) => (
                        <span key={m} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 font-mono text-[10px] text-zinc-400 shadow-sm transition-colors group-hover:border-zinc-600">
                          {m}
                        </span>
                      ))}
                      {ring.members.length > 8 && (
                        <span className="rounded border border-zinc-800 border-dashed bg-zinc-900/50 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">
                          +{ring.members.length - 8} more
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2">
                     <button className="flex-1 rounded border border-zinc-700 bg-zinc-800/50 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors">Isolate Cluster</button>
                     <button className="flex-1 rounded border border-red-500/30 bg-red-500/10 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20 transition-colors">Bulk Freeze</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <ErrorBanner message={network.error} />
        </Panel>

        {/* High-risk node list */}
        <Panel glow="red">
          <div className="flex items-center justify-between mb-4">
             <h3 className="text-base font-semibold text-zinc-100">Critical Threat Entities</h3>
             <span className="text-[10px] uppercase font-semibold text-red-400 bg-red-400/10 px-2 py-0.5 rounded tracking-wider">{highRiskNodes.length} tagged</span>
          </div>
          {network.loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : highRiskNodes.length === 0 ? (
            <EmptyState message="No critical threat entities catalogued." />
          ) : (
            <div className="space-y-1.5 max-h-[480px] overflow-y-auto pr-2 custom-scrollbar">
              {highRiskNodes.map((node) => (
                <div
                  key={node.id}
                  className="flex items-center gap-4 rounded-lg border border-zinc-800/60 bg-zinc-950/60 px-4 py-2.5 transition-colors hover:bg-zinc-800/50 group cursor-pointer"
                >
                  <div className="relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-30 bg-red-500"></span>
                    <div className={`relative h-2.5 w-2.5 shrink-0 rounded-full ${riskColor(node.risk).replace('text-', 'bg-')} shadow-[0_0_10px_rgba(239,68,68,0.5)]`} />
                  </div>
                  
                  <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                    <p className="truncate font-mono text-xs font-semibold text-zinc-200 group-hover:text-red-300 transition-colors">{node.id}</p>
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500">{node.label}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-widest leading-none mb-1">Threat Score</p>
                      <span className={`text-sm font-bold tabular-nums ${riskColor(node.risk)}`}>
                        {(node.risk * 100).toFixed(0)}%
                      </span>
                    </div>
                    <button className="opacity-0 group-hover:opacity-100 transition-opacity rounded border border-red-500/50 px-2 py-1 text-[10px] font-bold text-red-400 bg-red-500/10 hover:bg-red-500/20">Freeze</button>
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
