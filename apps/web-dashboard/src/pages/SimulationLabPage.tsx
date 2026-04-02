// ---------------------------------------------------------------------------
// SimulationLabPage — configure + run fraud simulations, view archetype list.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { KpiCard } from '../components/ui/KpiCard'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { SectionHeader } from '../components/ui/SectionHeader'
import { useApi } from '../hooks/useApi'
import { usePost } from '../hooks/usePost'
import type { SimRunResponse, ArchetypeInfo, GraphOverviewResponse } from '../types/api'

interface SimulationLabPageProps {
  apiBase: string
}

const RISK_LEVEL_BADGE: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-amber-400',
  low: 'text-emerald-400',
}

export function SimulationLabPage({ apiBase }: SimulationLabPageProps) {
  const [archetypes] = useApi<{ archetypes: ArchetypeInfo[] }>(apiBase, '/simulation/archetypes/detail')
  const [graphOverview, refreshGraph] = useApi<GraphOverviewResponse>(apiBase, '/graph-intelligence/overview')
  const [simState, runSim] = usePost<SimRunResponse>(apiBase, '/simulation/run')
  const [demoState, runDemo] = usePost<SimRunResponse>(apiBase, '/simulation/run-preset/demo-final')

  const [cfg, setCfg] = useState({
    count: 50,
    fraud_ratio: 0.18,
    max_amount: 5000,
    start_seconds_ago: 300,
  })
  const [lastSummary, setLastSummary] = useState<SimRunResponse['summary'] | null>(null)

  async function handleRun() {
    const result = await runSim(cfg)
    if (result) {
      setLastSummary(result.summary)
      void refreshGraph()
    }
  }

  async function handleDemoRun() {
    const result = await runDemo({})
    if (result) {
      setLastSummary(result.summary)
      void refreshGraph()
    }
  }

  const archList = archetypes.data?.archetypes ?? []
  const summary = lastSummary
  const demoBusy = demoState.status === 'pending'

  return (
    <div className="flex flex-col gap-6">
      {/* Judge Demo CTA */}
      <div className="flex items-start gap-4 rounded-xl border border-violet-500/30 bg-violet-500/10 px-5 py-4">
        <div className="flex-1">
          <p className="text-sm font-semibold text-violet-200">⬡ Judge Demo Mode</p>
          <p className="mt-1 text-xs text-zinc-400">
            Runs a deterministic, seed-locked scenario with 200 accounts · 3 mule rings · geo burst · device-sharing attack · 2 freeze events · 1 OTP · 1 hold escalation. Same story every time.
          </p>
          {demoState.error && <p className="mt-1 text-xs text-red-400">{demoState.error}</p>}
        </div>
        <button
          type="button"
          disabled={demoBusy}
          onClick={() => void handleDemoRun()}
          className="shrink-0 flex items-center gap-2 rounded-lg border border-violet-400/50 bg-violet-500/20 px-5 py-2.5 text-sm font-semibold text-violet-200 transition hover:bg-violet-500/30 disabled:opacity-50"
        >
          {demoBusy ? <Spinner size="sm" /> : '▶'} Run Judge Demo
        </button>
      </div>

      <SectionHeader
        title="Simulation Lab"
        subtitle="Inject realistic fraud archetypes and observe system response"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Config panel */}
        <Panel glow="violet">
          <h3 className="mb-4 text-base font-semibold text-zinc-100">Run Configuration</h3>
          <div className="grid gap-4">
            <label className="grid gap-1.5">
              <div className="flex justify-between">
                <span className="text-xs text-zinc-500">Transaction count</span>
                <span className="text-xs font-semibold text-violet-300">{cfg.count}</span>
              </div>
              <input
                type="range" min={5} max={300} step={5}
                value={cfg.count}
                onChange={(e) => setCfg((p) => ({ ...p, count: Number(e.target.value) }))}
                className="accent-violet-500 w-full"
              />
            </label>

            <label className="grid gap-1.5">
              <div className="flex justify-between">
                <span className="text-xs text-zinc-500">Fraud ratio</span>
                <span className="text-xs font-semibold text-red-400">{(cfg.fraud_ratio * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range" min={0} max={0.6} step={0.01}
                value={cfg.fraud_ratio}
                onChange={(e) => setCfg((p) => ({ ...p, fraud_ratio: Number(e.target.value) }))}
                className="accent-red-500 w-full"
              />
            </label>

            <label className="grid gap-1.5">
              <div className="flex justify-between">
                <span className="text-xs text-zinc-500">Max amount ($)</span>
                <span className="text-xs font-semibold text-amber-300">${cfg.max_amount.toLocaleString()}</span>
              </div>
              <input
                type="range" min={100} max={50000} step={100}
                value={cfg.max_amount}
                onChange={(e) => setCfg((p) => ({ ...p, max_amount: Number(e.target.value) }))}
                className="accent-amber-500 w-full"
              />
            </label>

            <button
              type="button"
              disabled={simState.status === 'pending'}
              onClick={() => void handleRun()}
              className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-violet-500/20 px-4 py-2.5 text-sm font-semibold text-violet-200 transition hover:bg-violet-500/30 disabled:opacity-50"
            >
              {simState.status === 'pending' ? <><Spinner size="sm" /> Running…</> : '⚗ Run Simulation'}
            </button>
          </div>
          <ErrorBanner message={simState.error} />
        </Panel>

        {/* Last run summary */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          {summary ? (
            <div className="grid gap-4 sm:grid-cols-4">
              <KpiCard label="Generated" value={summary.generated} accent="cyan" />
              <KpiCard label="Fraud Events" value={summary.fraud} accent="red" />
              <KpiCard label="Legit Events" value={summary.legit} accent="emerald" />
              <KpiCard label="Fraud Ratio" value={`${(summary.fraud_ratio * 100).toFixed(1)}%`} accent="amber" />
            </div>
          ) : (
            <Panel>
              <p className="text-sm text-zinc-600">Run a simulation to see results here.</p>
            </Panel>
          )}

          {/* Graph impact */}
          <Panel glow="cyan">
            <h3 className="mb-3 text-sm font-semibold text-zinc-300">Graph Impact</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(['nodes', 'edges', 'high_risk_nodes', 'mule_ring_signals'] as const).map((key) => (
                <div key={key} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <p className="text-[10px] text-zinc-600">{key.replace(/_/g, ' ')}</p>
                  <p className="mt-1.5 text-xl font-semibold text-cyan-200">
                    {graphOverview.data?.[key] ?? '—'}
                  </p>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* Archetypes catalogue */}
      <Panel>
        <h3 className="mb-4 text-base font-semibold text-zinc-100">Fraud Archetypes</h3>
        {archetypes.loading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {archList.map((a) => (
              <div key={a.id} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-100">{(a.name ?? a.id).replace(/_/g, ' ')}</p>
                  <span className={`text-[10px] font-semibold uppercase ${RISK_LEVEL_BADGE[a.risk_level] ?? 'text-zinc-400'}`}>
                    {a.risk_level}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{a.description}</p>
                <div className="mt-2 grid gap-1 text-[10px] text-zinc-500">
                  <p><span className="text-zinc-400">Pattern:</span> {a.risk_pattern}</p>
                  <p><span className="text-zinc-400">Shape:</span> {a.typical_graph_shape}</p>
                  <p><span className="text-zinc-400">Path:</span> <span className="font-mono text-zinc-400">{a.sample_path}</span></p>
                  <p><span className="text-zinc-400">Layer:</span> {a.detection_layer}</p>
                  <p><span className="text-zinc-400">Freeze:</span> {(a.freeze_probability * 100).toFixed(0)}%</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <ErrorBanner message={archetypes.error} />
      </Panel>
    </div>
  )
}
