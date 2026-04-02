import { useEffect, useMemo, useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { KpiCard } from '../components/ui/KpiCard'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { SectionHeader } from '../components/ui/SectionHeader'
import { EmptyState } from '../components/ui/EmptyState'
import { FraudGraphCanvas } from '../components/ui/FraudGraphCanvas'
import { ToastContainer } from '../components/ui/Toast'
import { useApi } from '../hooks/useApi'
import { useToast } from '../hooks/useToast'
import { apiPost } from '../lib/api'
import type {
  ClusterActionResponse,
  GraphNetworkResponse,
  GraphOverviewResponse,
  ReplayTimelineResponse,
  ThreatEntityActionResponse,
} from '../types/api'

interface GraphIntelligencePageProps {
  apiBase: string
}

function riskColor(risk: number): string {
  if (risk >= 0.8) return 'text-red-400'
  if (risk >= 0.6) return 'text-orange-400'
  if (risk >= 0.4) return 'text-amber-400'
  return 'text-emerald-400'
}

type SignatureTab = 'Pattern' | 'Rules' | 'Cases' | 'Mitigation'

const SIGNATURES = [
  {
    id: 'mule-laddering',
    fraud: 'Mule Laddering Network',
    modus: 'Victim funds fan into mule layer-1 accounts and rapidly hop to layer-2 before sink cashout.',
    rules: ['velocity_limit_breach', 'mule_cluster_density', 'repeated_beneficiary_anomaly'],
    confidence: 0.93,
    cases: ['case_seed_001', 'case_mule_2042'],
    pattern: 'Device sharing + repeated wallets + rapid cashout corridor',
    recommendation: 'Freeze layer-1 and layer-2 mule accounts, isolate sink corridor, enforce beneficiary cooldown.',
    mitigation: 'Immediate freeze + enhanced KYC + card/device blacklist sync + SAR filing.',
    timeline: 'T+0 victim transfer, T+2m mule hop, T+5m sink cashout',
  },
  {
    id: 'account-takeover',
    fraud: 'Credential Takeover Spike',
    modus: 'Compromised account performs unusual high-value wire bursts to new beneficiaries.',
    rules: ['amount_to_org_balance_ratio', 'night_window', 'queue_risk_score'],
    confidence: 0.88,
    cases: ['case_ato_112', 'case_ato_601'],
    pattern: 'Night burst + unfamiliar beneficiary + extreme amount ratio',
    recommendation: 'Hold transaction, trigger OTP step-up, suspend beneficiary payout.',
    mitigation: 'Progressive auth, device trust reset, forced credential rotation.',
    timeline: 'T+0 login anomaly, T+1m wire launch, T+4m repeat burst',
  },
  {
    id: 'cross-border-smurfing',
    fraud: 'Cross-border Smurfing',
    modus: 'Funds split into smaller transfers across multiple channels to evade static thresholds.',
    rules: ['drift_alert_signal', 'amount_log', 'balance_delta_dest'],
    confidence: 0.84,
    cases: ['case_cb_42', 'case_cb_77'],
    pattern: 'Low-value repeated cross-channel bursts with mule fan-out',
    recommendation: 'Aggregate by beneficiary graph, enforce dynamic threshold, queue for analyst review.',
    mitigation: 'Adaptive thresholds + corridor watchlist + limit tightening.',
    timeline: 'T+0 fan-out start, T+8m 12 micro transfers, T+18m destination consolidation',
  },
]

export function GraphIntelligencePage({ apiBase }: GraphIntelligencePageProps) {
  const [overview, refreshOverview] = useApi<GraphOverviewResponse>(apiBase, '/graph-intelligence/overview')
  const [network, refreshNetwork] = useApi<GraphNetworkResponse>(apiBase, '/graph-intelligence/network')
  const [replay, refreshReplay] = useApi<ReplayTimelineResponse>(apiBase, '/graph-intelligence/replay-path?seed=demo_victim_01&limit=20')
  const addToast = useToast()

  const [selectedRingAction, setSelectedRingAction] = useState<Record<string, boolean>>({})
  const [replayState, setReplayState] = useState<'idle' | 'playing' | 'paused'>('idle')
  const [replayIndex, setReplayIndex] = useState(-1)
  const [replaySpeed, setReplaySpeed] = useState(1)
  const [signatureOpen, setSignatureOpen] = useState<string | null>(null)
  const [signatureTab, setSignatureTab] = useState<SignatureTab>('Pattern')
  const [freezeBusy, setFreezeBusy] = useState<Record<string, boolean>>({})

  const rings = useMemo(() => network.data?.rings ?? [], [network.data?.rings])
  const nodes = useMemo(() => network.data?.nodes ?? [], [network.data?.nodes])
  const highRiskNodes = useMemo(() => nodes.filter((n) => n.risk >= 0.7).slice(0, 20), [nodes])
  const replaySteps = replay.data?.steps ?? []

  async function runClusterAction(clusterId: string, action: 'expand_cluster' | 'isolate_cluster' | 'trace_inbound_funds' | 'trace_outbound_funds' | 'mark_mule_ring_suspicious') {
    if (selectedRingAction[clusterId]) return
    setSelectedRingAction((p) => ({ ...p, [clusterId]: true }))
    try {
      const out = await apiPost<ClusterActionResponse>(apiBase, `/graph-intelligence/clusters/${clusterId}/action`, { action })
      await refreshNetwork()
      const message = action === 'mark_mule_ring_suspicious'
        ? `Cluster ${clusterId} marked suspicious; ${out.updated_nodes} nodes updated.`
        : `${clusterId}: ${action.replaceAll('_', ' ')} returned ${out.linked_accounts.length} linked accounts.`
      addToast(message, 'success')
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Cluster action failed', 'error')
    } finally {
      setSelectedRingAction((p) => ({ ...p, [clusterId]: false }))
    }
  }

  async function freezeEntity(id: string) {
    if (freezeBusy[id]) return
    setFreezeBusy((p) => ({ ...p, [id]: true }))
    try {
      const out = await apiPost<ThreatEntityActionResponse>(apiBase, `/threat-entities/${id}/freeze`, {})
      addToast(`Entity ${out.entity_id} frozen and case ${out.case_id} created.`, 'success')
      await refreshNetwork()
      await refreshOverview()
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Freeze failed', 'error')
    } finally {
      setFreezeBusy((p) => ({ ...p, [id]: false }))
    }
  }

  async function rollbackEntity(id: string) {
    if (freezeBusy[id]) return
    setFreezeBusy((p) => ({ ...p, [id]: true }))
    try {
      const out = await apiPost<ThreatEntityActionResponse>(apiBase, `/threat-entities/${id}/rollback`, {})
      addToast(`Entity ${out.entity_id} rollback completed.`, 'info')
      await refreshNetwork()
      await refreshOverview()
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Rollback failed', 'error')
    } finally {
      setFreezeBusy((p) => ({ ...p, [id]: false }))
    }
  }

  function playReplay() {
    if (replaySteps.length === 0) {
      addToast('No replay timeline available.', 'error')
      return
    }
    setReplayState('playing')
    if (replayIndex < 0) setReplayIndex(0)
  }

  useEffect(() => {
    if (replayState !== 'playing' || replaySteps.length === 0) return
    const timer = window.setTimeout(() => {
      setReplayIndex((i) => {
        const next = i + 1
        if (next >= replaySteps.length) {
          setReplayState('paused')
          return replaySteps.length - 1
        }
        return next
      })
    }, Math.max(250, 1200 / replaySpeed))
    return () => window.clearTimeout(timer)
  }, [replayState, replayIndex, replaySteps.length, replaySpeed])

  const activeReplay = replayIndex >= 0 ? replaySteps[replayIndex] : null
  const signature = SIGNATURES.find((s) => s.id === signatureOpen) ?? null

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Topology Intelligence"
        subtitle="Operational graph analysis: track value transfer paths, isolate rings, freeze entities, and replay suspicious routes"
        action={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setReplayIndex(0); playReplay() }}
              className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-300 hover:bg-violet-500/20"
            >
              ▶ Replay suspected fraud paths
            </button>
            <button
              type="button"
              onClick={() => { void refreshOverview(); void refreshNetwork(); void refreshReplay() }}
              className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-300 hover:text-cyan-200"
            >
              ↻ Sync graph state
            </button>
          </div>
        }
      />

      {overview.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-28 rounded-xl bg-zinc-900/50 border border-zinc-800/50" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Nodes Catalogued" value={overview.data?.nodes} accent="cyan" />
          <KpiCard label="Value Edges" value={overview.data?.edges} accent="cyan" />
          <KpiCard label="Critical Risk Entities" value={overview.data?.high_risk_nodes} accent="red" />
          <KpiCard label="Ring Structures Detected" value={overview.data?.mule_ring_signals} accent="violet" />
        </div>
      )}

      <Panel glow="cyan" className="p-0 overflow-hidden relative">
        <div className="absolute top-4 left-4 z-10 w-full pr-8">
          <h3 className="text-base font-semibold text-zinc-100">Entity Relationship Visualization</h3>
          <p className="text-xs text-zinc-400 mt-1">Drag nodes to pin, release to settle. Pan by dragging empty space. Trackpad wheel for smooth zoom.</p>
          <div className="mt-3 flex flex-wrap gap-2 items-center">
            <button type="button" onClick={playReplay} className="rounded border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs text-violet-300">Play</button>
            <button type="button" onClick={() => setReplayState('paused')} className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300">Pause</button>
            <button type="button" onClick={() => { setReplayState('idle'); setReplayIndex(-1) }} className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300">Restart</button>
            <label className="text-[11px] text-zinc-400">Speed
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.5}
                value={replaySpeed}
                onChange={(e) => setReplaySpeed(Number(e.target.value))}
                className="ml-2 align-middle accent-violet-400"
              />
            </label>
            {activeReplay && (
              <span className="rounded border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[10px] text-violet-200">
                Step {activeReplay.order}/{replaySteps.length} • {new Date(activeReplay.timestamp).toLocaleTimeString()} • Cum ${activeReplay.cumulative_amount.toFixed(2)}
              </span>
            )}
          </div>
        </div>
        {network.loading ? (
          <div className="flex h-[540px] items-center justify-center"><Spinner size="lg" /></div>
        ) : (
          <FraudGraphCanvas
            nodes={nodes}
            edges={network.data?.edges ?? []}
            height={540}
            replay={replaySteps}
            replayIndex={replayIndex}
          />
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
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
              {rings.map((ring) => {
                const busy = !!selectedRingAction[ring.id]
                return (
                  <div key={ring.id} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-zinc-200">{ring.id}</span>
                      <span className={`text-sm font-bold ${riskColor(ring.risk)}`}>{(ring.risk * 100).toFixed(0)}%</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {ring.members.slice(0, 10).map((m) => <span key={m} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 font-mono text-[10px] text-zinc-400">{m}</span>)}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button disabled={busy} onClick={() => void runClusterAction(ring.id, 'expand_cluster')} className="rounded border border-zinc-700 bg-zinc-800/50 py-1.5 text-xs text-zinc-300 disabled:opacity-40">Expand cluster</button>
                      <button disabled={busy} onClick={() => void runClusterAction(ring.id, 'isolate_cluster')} className="rounded border border-zinc-700 bg-zinc-800/50 py-1.5 text-xs text-zinc-300 disabled:opacity-40">Isolate cluster</button>
                      <button disabled={busy} onClick={() => void runClusterAction(ring.id, 'trace_inbound_funds')} className="rounded border border-zinc-700 bg-zinc-800/50 py-1.5 text-xs text-zinc-300 disabled:opacity-40">Trace inbound funds</button>
                      <button disabled={busy} onClick={() => void runClusterAction(ring.id, 'trace_outbound_funds')} className="rounded border border-zinc-700 bg-zinc-800/50 py-1.5 text-xs text-zinc-300 disabled:opacity-40">Trace outbound funds</button>
                      <button disabled={busy} onClick={() => void runClusterAction(ring.id, 'mark_mule_ring_suspicious')} className="col-span-2 rounded border border-red-500/30 bg-red-500/10 py-1.5 text-xs font-semibold text-red-300 disabled:opacity-40">Mark mule ring suspicious</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <ErrorBanner message={network.error} />
        </Panel>

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
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
              {highRiskNodes.map((node) => (
                <div key={node.id} className="flex items-center gap-4 rounded-lg border border-zinc-800/60 bg-zinc-950/60 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs font-semibold text-zinc-200">{node.id}</p>
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500">{node.label} • {(node.risk * 100).toFixed(0)}%</p>
                    {node.status === 'frozen' && <span className="inline-block mt-1 rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-300">FROZEN</span>}
                  </div>
                  <div className="flex gap-2">
                    <button
                      disabled={!!freezeBusy[node.id]}
                      onClick={() => void freezeEntity(node.id)}
                      className="rounded border border-red-500/50 px-2 py-1 text-[10px] font-bold text-red-400 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40"
                    >
                      Freeze
                    </button>
                    <button
                      disabled={!!freezeBusy[node.id]}
                      onClick={() => void rollbackEntity(node.id)}
                      className="rounded border border-zinc-700 px-2 py-1 text-[10px] font-bold text-zinc-300 bg-zinc-800/60 hover:bg-zinc-700 disabled:opacity-40"
                    >
                      Rollback
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel glow="amber">
        <h3 className="mb-3 text-base font-semibold text-zinc-100">Known Threat Signatures</h3>
        <div className="grid gap-3 md:grid-cols-3">
          {SIGNATURES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { setSignatureOpen(s.id); setSignatureTab('Pattern') }}
              className="text-left rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 hover:border-zinc-700 hover:bg-zinc-900/60"
            >
              <p className="text-sm font-semibold text-zinc-200">{s.fraud}</p>
              <p className="mt-1 text-xs text-zinc-500 line-clamp-2">{s.modus}</p>
            </button>
          ))}
        </div>
      </Panel>

      {signature && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-[min(960px,94vw)] rounded-2xl border border-zinc-700 bg-zinc-950 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-zinc-100">{signature.fraud}</h3>
              <button type="button" onClick={() => setSignatureOpen(null)} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300">Close</button>
            </div>
            <div className="mt-3 flex gap-2">
              {(['Pattern', 'Rules', 'Cases', 'Mitigation'] as SignatureTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setSignatureTab(tab)}
                  className={`rounded border px-2.5 py-1 text-xs ${signatureTab === tab ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300' : 'border-zinc-700 bg-zinc-900 text-zinc-400'}`}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-300">
              {signatureTab === 'Pattern' && (
                <div className="space-y-2">
                  <p><span className="text-zinc-500">Modus operandi:</span> {signature.modus}</p>
                  <p><span className="text-zinc-500">Mule behavior:</span> {signature.pattern}</p>
                  <p><span className="text-zinc-500">ML confidence:</span> {(signature.confidence * 100).toFixed(1)}%</p>
                  <p><span className="text-zinc-500">Example timeline:</span> {signature.timeline}</p>
                </div>
              )}
              {signatureTab === 'Rules' && (
                <ul className="list-disc pl-5 space-y-1">{signature.rules.map((r) => <li key={r}>{r}</li>)}</ul>
              )}
              {signatureTab === 'Cases' && (
                <ul className="list-disc pl-5 space-y-1">{signature.cases.map((c) => <li key={c}>{c}</li>)}</ul>
              )}
              {signatureTab === 'Mitigation' && (
                <div className="space-y-2">
                  <p><span className="text-zinc-500">Analyst recommendations:</span> {signature.recommendation}</p>
                  <p><span className="text-zinc-500">Mitigation playbook:</span> {signature.mitigation}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ErrorBanner message={overview.error || replay.error} />
      <ToastContainer />
    </div>
  )
}
