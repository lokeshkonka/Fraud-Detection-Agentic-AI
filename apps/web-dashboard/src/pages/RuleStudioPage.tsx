// ---------------------------------------------------------------------------
// RuleStudioPage — view and simulate rule threshold updates.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { SectionHeader } from '../components/ui/SectionHeader'
import { useApi } from '../hooks/useApi'
import { usePost } from '../hooks/usePost'
import type { RuleStudioResponse, RuleEvalResponse } from '../types/api'

interface RuleStudioPageProps {
  apiBase: string
}

const CHANNEL_OPTIONS = ['wire', 'crypto', 'upi', 'ach', 'card'] as const

export function RuleStudioPage({ apiBase }: RuleStudioPageProps) {
  const [rules, refreshRules] = useApi<RuleStudioResponse>(apiBase, '/rule-studio/rules')
  const [evalState, evalRules] = usePost<RuleEvalResponse>(apiBase, '/rule-studio/rules/evaluate')

  const current = rules.data?.rules
  const [form, setForm] = useState({
    risk_threshold: 0.6,
    velocity_limit: 5,
    high_risk_channels: ['wire', 'crypto', 'upi'] as string[],
  })

  function toggleChannel(ch: string) {
    setForm((prev) => ({
      ...prev,
      high_risk_channels: prev.high_risk_channels.includes(ch)
        ? prev.high_risk_channels.filter((c) => c !== ch)
        : [...prev.high_risk_channels, ch],
    }))
  }

  async function handleEval() {
    const result = await evalRules(form)
    if (result) void refreshRules()
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Rule Studio"
        subtitle="Simulate risk threshold and velocity rule changes — non-destructive demo tuning"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Current rules */}
        <Panel>
          <h3 className="mb-4 text-base font-semibold text-zinc-100">Active Rules</h3>
          {rules.loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : current ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                <p className="text-xs text-zinc-500">Risk Threshold</p>
                <p className="mt-1 text-2xl font-bold text-cyan-200">{current.risk_threshold.toFixed(2)}</p>
                <p className="mt-1 text-[10px] text-zinc-600">Transactions above this score are flagged</p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                <p className="text-xs text-zinc-500">Velocity Limit</p>
                <p className="mt-1 text-2xl font-bold text-cyan-200">{current.velocity_limit}</p>
                <p className="mt-1 text-[10px] text-zinc-600">Max transactions per 5-minute window</p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                <p className="mb-2 text-xs text-zinc-500">High-Risk Channels</p>
                <div className="flex flex-wrap gap-2">
                  {current.high_risk_channels.map((ch) => (
                    <span key={ch} className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
                      {ch}
                    </span>
                  ))}
                </div>
              </div>

              <pre className="overflow-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-[11px] text-zinc-400 leading-relaxed">
                {JSON.stringify(current, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-sm text-zinc-600">No rules loaded</p>
          )}
          <ErrorBanner message={rules.error} />
        </Panel>

        {/* Rule simulation editor */}
        <Panel glow="cyan">
          <h3 className="mb-4 text-base font-semibold text-zinc-100">Simulate Rule Update</h3>
          <div className="space-y-5">
            <label className="grid gap-2">
              <div className="flex justify-between">
                <span className="text-xs text-zinc-500">Risk Threshold</span>
                <span className="text-xs font-semibold text-cyan-300">{form.risk_threshold.toFixed(2)}</span>
              </div>
              <input
                type="range" min={0.3} max={0.95} step={0.01}
                value={form.risk_threshold}
                onChange={(e) => setForm((p) => ({ ...p, risk_threshold: Number(e.target.value) }))}
                className="accent-cyan-500 w-full"
              />
              <div className="flex justify-between text-[10px] text-zinc-600">
                <span>0.30 (permissive)</span>
                <span>0.95 (strict)</span>
              </div>
            </label>

            <label className="grid gap-2">
              <div className="flex justify-between">
                <span className="text-xs text-zinc-500">Velocity Limit</span>
                <span className="text-xs font-semibold text-cyan-300">{form.velocity_limit} tx/5min</span>
              </div>
              <input
                type="range" min={1} max={20} step={1}
                value={form.velocity_limit}
                onChange={(e) => setForm((p) => ({ ...p, velocity_limit: Number(e.target.value) }))}
                className="accent-cyan-500 w-full"
              />
            </label>

            <div className="grid gap-2">
              <span className="text-xs text-zinc-500">High-Risk Channels</span>
              <div className="flex flex-wrap gap-2">
                {CHANNEL_OPTIONS.map((ch) => {
                  const active = form.high_risk_channels.includes(ch)
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => toggleChannel(ch)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        active
                          ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                          : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {ch}
                    </button>
                  )
                })}
              </div>
            </div>

            <button
              type="button"
              disabled={evalState.status === 'pending'}
              onClick={() => void handleEval()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-500/20 px-4 py-2.5 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/30 disabled:opacity-50"
            >
              {evalState.status === 'pending' ? <><Spinner size="sm" /> Applying…</> : '⊛ Apply Simulation'}
            </button>

            {evalState.data && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-300">
                ✓ {evalState.data.note}
              </div>
            )}
            <ErrorBanner message={evalState.error} />
          </div>
        </Panel>
      </div>

      {/* Governance notes */}
      <Panel>
        <h3 className="mb-3 text-sm font-semibold text-zinc-300">Governance Notes</h3>
        <ul className="space-y-2 text-sm text-zinc-500">
          <li className="flex gap-2"><span className="text-cyan-500/60">•</span> Rule changes here are non-destructive simulation updates — production scoring is not mutated.</li>
          <li className="flex gap-2"><span className="text-cyan-500/60">•</span> All rule evaluations are logged to the audit trail for governance compliance.</li>
          <li className="flex gap-2"><span className="text-cyan-500/60">•</span> Use Model Ops → Promote to push a validated challenger to champion status.</li>
          <li className="flex gap-2"><span className="text-cyan-500/60">•</span> High-risk channel classification directly impacts the inference service rule score component.</li>
        </ul>
      </Panel>
    </div>
  )
}
