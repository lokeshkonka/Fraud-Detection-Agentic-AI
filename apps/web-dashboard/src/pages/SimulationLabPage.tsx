// ---------------------------------------------------------------------------
// SimulationLabPage — configure + run fraud simulations, view archetype list.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { KpiCard } from '../components/ui/KpiCard'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { SectionHeader } from '../components/ui/SectionHeader'
import { ToastContainer } from '../components/ui/Toast'
import { useToast } from '../hooks/useToast'
import { useApi } from '../hooks/useApi'
import { usePost } from '../hooks/usePost'
import type { SimRunResponse, ArchetypeInfo, GraphOverviewResponse } from '../types/api'

interface SimulationLabPageProps {
  apiBase: string
}

const RISK_LEVEL_BADGE: Record<string, string> = {
  critical: 'text-red-400 bg-red-400/10 border-red-400/20',
  high: 'text-orange-400 bg-orange-400/10 border-orange-400/20',
  medium: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  low: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
}

export function SimulationLabPage({ apiBase }: SimulationLabPageProps) {
  const [archetypes] = useApi<{ archetypes: ArchetypeInfo[] }>(apiBase, '/simulation/archetypes/detail')
  const [graphOverview, refreshGraph] = useApi<GraphOverviewResponse>(apiBase, '/graph-intelligence/overview')
  const [simState, runSim] = usePost<SimRunResponse>(apiBase, '/simulation/run')
  const [demoState, runDemo] = usePost<SimRunResponse>(apiBase, '/simulation/run-preset/demo-final')
  const addToast = useToast()

  const [cfg, setCfg] = useState({
    count: 50,
    fraud_ratio: 0.18,
    max_amount: 5000,
    start_seconds_ago: 300,
  })
  const [lastSummary, setLastSummary] = useState<SimRunResponse['summary'] | null>(null)

  const triggerEventToasts = (summaryData: SimRunResponse['summary']) => {
    // Show event toast stack sequentially to make it feel alive
    setTimeout(() => addToast(`✓ ${summaryData.generated} internal accounts verified & mapped`, 'success'), 300)
    setTimeout(() => addToast(`⚠ ${summaryData.fraud} suspicious paths detected & injected`, 'error'), 1200)
    setTimeout(() => addToast(`⚑ ${Math.floor(summaryData.fraud * 0.4)} freeze actions queued implicitly`, 'info'), 2100)
    setTimeout(() => addToast(`⬡ Entity topology successfully synchronized`, 'success'), 3000)
  }

  async function handleRun() {
    const result = await runSim(cfg)
    if (result) {
      setLastSummary(result.summary)
      void refreshGraph()
      triggerEventToasts(result.summary)
    }
  }

  async function handleDemoRun() {
    const result = await runDemo({})
    if (result) {
      setLastSummary(result.summary)
      void refreshGraph()
      triggerEventToasts(result.summary)
    }
  }

  const archList = archetypes.data?.archetypes ?? []
  const summary = lastSummary
  const demoBusy = demoState.status === 'pending'
  const simBusy = simState.status === 'pending'

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Threat Simulation Lab"
        subtitle="Inject realistic fraud archetypes into the environment to calibrate detection layers"
      />

      {/* Judge Demo CTA */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 rounded-xl border border-violet-500/30 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-violet-900/20 via-zinc-950 to-zinc-950 px-6 py-5 shadow-[inset_0_0_20px_rgba(139,92,246,0.05)]">
        <div className="flex-1">
          <p className="text-sm font-semibold text-violet-200 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
               <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
               <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
            </span>
            Judge Demo Mode
          </p>
          <p className="mt-1.5 text-xs text-zinc-400 max-w-2xl leading-relaxed">
            Runs a deterministic, seed-locked scenario mapping 200 accounts and 3 coordinated mule rings. Initiates geo burst attack, device-sharing collisions, 2 freeze paths, and 1 hold escalation.
          </p>
          {demoState.error && <p className="mt-2 text-xs font-semibold text-red-400">{demoState.error}</p>}
        </div>
        <button
          type="button"
          disabled={demoBusy}
          onClick={() => void handleDemoRun()}
          className="shrink-0 flex items-center gap-2 rounded-lg border border-violet-500/50 bg-violet-600 hover:bg-violet-500 px-6 py-3 text-sm font-bold text-white transition-all shadow-[0_0_15px_rgba(139,92,246,0.4)] disabled:opacity-50 disabled:bg-violet-900"
        >
          {demoBusy ? <Spinner size="sm" className="text-white"/> : '▶'} Execute Judge Scenario
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Config panel */}
        <Panel glow="violet" className="col-span-12 lg:col-span-4 self-start sticky top-24">
          <div className="flex items-center justify-between mb-5">
             <h3 className="text-base font-semibold text-zinc-100">Custom Payload</h3>
             <span className="text-[10px] uppercase font-semibold tracking-wider text-zinc-500">Parameters</span>
          </div>
          <div className="grid gap-5">
            <label className="grid gap-2 group">
              <div className="flex justify-between items-baseline">
                <span className="text-xs font-medium text-zinc-400 group-hover:text-zinc-200 transition-colors">Volume Set</span>
                <span className="text-sm font-bold text-violet-300 bg-violet-500/10 px-2 py-0.5 rounded tabular-nums">{cfg.count}</span>
              </div>
              <input
                type="range" min={5} max={300} step={5}
                value={cfg.count}
                onChange={(e) => setCfg((p) => ({ ...p, count: Number(e.target.value) }))}
                className="accent-violet-500 w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
              />
            </label>

            <label className="grid gap-2 group">
              <div className="flex justify-between items-baseline">
                <span className="text-xs font-medium text-zinc-400 group-hover:text-zinc-200 transition-colors">Threat Density</span>
                <span className="text-sm font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded tabular-nums">{(cfg.fraud_ratio * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range" min={0} max={0.6} step={0.01}
                value={cfg.fraud_ratio}
                onChange={(e) => setCfg((p) => ({ ...p, fraud_ratio: Number(e.target.value) }))}
                className="accent-red-500 w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
              />
            </label>

            <label className="grid gap-2 group">
              <div className="flex justify-between items-baseline">
                <span className="text-xs font-medium text-zinc-400 group-hover:text-zinc-200 transition-colors">Ceiling Value ($)</span>
                <span className="text-sm font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded tabular-nums">${cfg.max_amount.toLocaleString()}</span>
              </div>
              <input
                type="range" min={100} max={50000} step={100}
                value={cfg.max_amount}
                onChange={(e) => setCfg((p) => ({ ...p, max_amount: Number(e.target.value) }))}
                className="accent-amber-500 w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
              />
            </label>

            <div className="pt-2">
               <button
                 type="button"
                 disabled={simBusy}
                 onClick={() => void handleRun()}
                 className={`w-full flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-bold transition-all ${simBusy ? 'bg-violet-900 border-violet-800 text-violet-400 opacity-50' : 'bg-violet-500/10 hover:bg-violet-500/20 border-violet-500/30 text-violet-200 shadow-[0_0_15px_rgba(139,92,246,0.1)] hover:shadow-[0_0_20px_rgba(139,92,246,0.2)]'}`}
               >
                 {simBusy ? <><Spinner size="sm" /> Compiling Matrix…</> : '⚗ Inject Custom Simulation'}
               </button>
            </div>
            {summary && (
              <p className="text-xs text-center font-medium text-emerald-400 animate-[fadeIn_.3s_ease] mt-1">
                {summary.fraud} suspicious paths injected • Graph synced
              </p>
            )}
          </div>
          <ErrorBanner message={simState.error} />
        </Panel>

        {/* Results & Integrity */}
        <div className="flex flex-col gap-6 col-span-12 lg:col-span-8">
          {summary ? (
             <div className="grid gap-4 sm:grid-cols-4 animate-[fadeIn_.4s_ease]">
               <KpiCard label="Nodes Initialized" value={summary.generated} accent="cyan" />
               <KpiCard label="Threat Vectors" value={summary.fraud} accent="red" />
               <KpiCard label="Clear Ops" value={summary.legit} accent="emerald" />
               <KpiCard label="Actual Density" value={`${(summary.fraud_ratio * 100).toFixed(1)}%`} accent="amber" />
             </div>
          ) : (
             <div className="h-32 border border-dashed border-zinc-800/80 rounded-xl bg-zinc-950 flex flex-col items-center justify-center gap-2 text-zinc-500">
               <span className="text-2xl opacity-50">🧭</span>
               <p className="text-xs font-medium">Awaiting simulation instructions.</p>
             </div>
          )}

          {/* Graph impact */}
          <Panel glow="cyan">
            <h3 className="mb-4 text-sm font-semibold text-zinc-200">Topology State Monitor</h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {(['nodes', 'edges', 'high_risk_nodes', 'mule_ring_signals'] as const).map((key) => (
                <div key={key} className="relative overflow-hidden rounded-lg border border-cyan-900/20 bg-zinc-950 p-4 transition-colors hover:border-cyan-500/30 group">
                  <div className="absolute top-0 left-0 w-1 h-full bg-cyan-500/20 group-hover:bg-cyan-500/50 transition-colors"></div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 group-hover:text-cyan-400/70 transition-colors">{key.replace(/_/g, ' ')}</p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-100 group-hover:text-white transition-colors">
                    {graphOverview.data?.[key] ?? '—'}
                  </p>
                </div>
              ))}
            </div>
            {summary && (
              <div className="mt-4 flex gap-3 text-xs border-t border-zinc-800/80 pt-4">
                   <button onClick={() => { window.location.hash = '/graph-intelligence' }} className="rounded bg-cyan-500/10 px-3 py-1.5 font-medium text-cyan-300 hover:bg-cyan-500/20 transition-colors">
                     Inspect New Topology →
                   </button>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* Archetypes catalogue */}
      <h3 className="mt-4 text-lg font-semibold text-zinc-100">Known Threat Signatures</h3>
      {archetypes.loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {archList.map((a) => (
            <div key={a.id} className="group rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 hover:bg-zinc-900 hover:border-zinc-700 transition-all cursor-crosshair">
              <div className="flex items-start justify-between gap-3 mb-3">
                <p className="text-sm font-bold text-zinc-200 group-hover:text-cyan-300 transition-colors leading-tight">{(a.name ?? a.id).replace(/_/g, ' ')}</p>
                <span className={`shrink-0 rounded border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${RISK_LEVEL_BADGE[a.risk_level] ?? 'text-zinc-400 bg-zinc-400/10 border-zinc-400/20'}`}>
                  {a.risk_level}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-zinc-500 group-hover:text-zinc-400 transition-colors">{a.description}</p>
              
              <div className="mt-4 space-y-1.5 border-t border-zinc-800/50 pt-3">
                <div className="flex justify-between text-[10px]">
                   <span className="text-zinc-500">Pattern</span>
                   <span className="text-zinc-300 font-medium">{a.risk_pattern}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                   <span className="text-zinc-500">Vector</span>
                   <span className="text-violet-300 font-mono tracking-tighter truncate max-w-[120px]">{a.sample_path}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                   <span className="text-zinc-500">Layer</span>
                   <span className="text-zinc-300 font-medium">{a.detection_layer}</span>
                </div>
                <div className="grid mt-2 gap-1 content-end h-3">
                   <div className="flex h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                      <div className="bg-red-500/80 rounded-full" style={{width: `${a.freeze_probability * 100}%`}}></div>
                   </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <ErrorBanner message={archetypes.error} />
      <ToastContainer />
    </div>
  )
}
