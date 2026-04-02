import { useMemo, useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { SectionHeader } from '../components/ui/SectionHeader'
import { ToastContainer } from '../components/ui/Toast'
import { useToast } from '../hooks/useToast'
import { useApi } from '../hooks/useApi'
import { usePost } from '../hooks/usePost'
import type { RuleEvalResponse, RuleStudioResponse, RuleSetInput, TransactionFlowResponse } from '../types/api'

interface RuleStudioPageProps {
  apiBase: string
}

const CHANNEL_OPTIONS = ['wire', 'crypto', 'upi', 'ach', 'card'] as const
const FEATURE_RULES: Array<{ key: keyof RuleSetInput; label: string; min: number; max: number; step: number }> = [
  { key: 'balance_delta_org_threshold', label: 'balance_delta_org', min: 100, max: 10000, step: 50 },
  { key: 'balance_delta_dest_threshold', label: 'balance_delta_dest', min: 100, max: 10000, step: 50 },
  { key: 'amount_log_threshold', label: 'amount_log', min: 2, max: 12, step: 0.1 },
  { key: 'amount_to_org_balance_ratio_threshold', label: 'amount_to_org_balance_ratio', min: 0.05, max: 2.0, step: 0.01 },
  { key: 'amount_to_dest_balance_ratio_threshold', label: 'amount_to_dest_balance_ratio (safe denominator)', min: 0.05, max: 3.0, step: 0.01 },
  { key: 'queue_risk_score_threshold', label: 'queue risk score', min: 0.1, max: 0.99, step: 0.01 },
  { key: 'drift_alert_signal_threshold', label: 'drift alert signals', min: 0.05, max: 0.5, step: 0.01 },
  { key: 'mule_cluster_density_threshold', label: 'mule cluster density', min: 0.05, max: 0.95, step: 0.01 },
  { key: 'repeated_beneficiary_anomaly_threshold', label: 'repeated beneficiary anomaly', min: 1, max: 20, step: 1 },
]

const defaultRuleSet: RuleSetInput = {
  risk_threshold: 0.55,
  velocity_limit: 4,
  high_risk_channels: ['wire', 'crypto', 'upi'],
  balance_delta_org_threshold: 2500,
  balance_delta_dest_threshold: 2500,
  amount_log_threshold: 7.0,
  amount_to_org_balance_ratio_threshold: 0.6,
  amount_to_dest_balance_ratio_threshold: 1.2,
  queue_risk_score_threshold: 0.7,
  drift_alert_signal_threshold: 0.15,
  mule_cluster_density_threshold: 0.4,
  repeated_beneficiary_anomaly_threshold: 3,
  expression_mode: 'AND',
  confidence_weight: 0.5,
  override_ml_score: false,
  shadow_mode: true,
  analyst_approval_required: false,
}

export function RuleStudioPage({ apiBase }: RuleStudioPageProps) {
  const [rules, refreshRules] = useApi<RuleStudioResponse>(apiBase, '/rule-studio/rules')
  const [evalState, evalRules] = usePost<RuleEvalResponse>(apiBase, '/rule-studio/rules/evaluate')
  const [recentTx] = useApi<TransactionFlowResponse>(apiBase, '/transaction-flow/recent?limit=20')
  const addToast = useToast()

  const current = useMemo(() => ({ ...defaultRuleSet, ...(rules.data?.rules ?? {}) }), [rules.data?.rules])
  const [draft, setDraft] = useState<RuleSetInput | null>(null)
  const form = draft ?? current

  function toggleChannel(ch: string) {
    setDraft((prev) => {
      const base = prev ?? form
      return {
        ...base,
        high_risk_channels: base.high_risk_channels.includes(ch)
          ? base.high_risk_channels.filter((c) => c !== ch)
          : [...base.high_risk_channels, ch],
      }
    })
  }

  async function handleEval() {
    const result = await evalRules(form)
    if (result) {
      addToast('Rule simulation persisted with updated ML-aligned feature thresholds.', 'success')
      void refreshRules()
    } else {
      addToast('Rule simulation failed.', 'error')
    }
  }

  const simulatedImpacts = useMemo(() => {
    const items = recentTx.data?.items ?? []
    const hits = items.filter((t) => {
      const amountRule = t.amount > form.balance_delta_org_threshold || t.amount > form.balance_delta_dest_threshold
      const channelRule = form.high_risk_channels.includes(t.channel)
      const scoreRule = t.score >= form.queue_risk_score_threshold
      return form.expression_mode === 'AND' ? (amountRule && scoreRule) : (amountRule || channelRule || scoreRule)
    })
    return { total: items.length, flagged: hits.length, flaggedPct: items.length ? (hits.length / items.length) * 100 : 0 }
  }, [recentTx.data?.items, form])

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Rule Studio"
        subtitle="Updated feature-engineering aligned rules with AND/OR groups, confidence weighting, shadow mode, and analyst approval workflow"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <h3 className="mb-4 text-base font-semibold text-zinc-100">Active Rules</h3>
          {rules.loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-xs text-zinc-500">Risk Threshold</p><p className="mt-1 text-xl font-bold text-cyan-200">{current.risk_threshold.toFixed(2)}</p></div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-xs text-zinc-500">Velocity Limit</p><p className="mt-1 text-xl font-bold text-cyan-200">{current.velocity_limit}</p></div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-xs text-zinc-500">Expression</p><p className="mt-1 text-xl font-bold text-violet-200">{current.expression_mode}</p></div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-xs text-zinc-500">Confidence Weight</p><p className="mt-1 text-xl font-bold text-violet-200">{current.confidence_weight.toFixed(2)}</p></div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                <p className="mb-2 text-xs text-zinc-500">High-Risk Channels</p>
                <div className="flex flex-wrap gap-2">
                  {current.high_risk_channels.map((ch) => <span key={ch} className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">{ch}</span>)}
                </div>
              </div>
              <pre className="overflow-auto rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-zinc-400 leading-relaxed">{JSON.stringify(current, null, 2)}</pre>
            </div>
          )}
          <ErrorBanner message={rules.error} />
        </Panel>

        <Panel glow="cyan">
          <h3 className="mb-4 text-base font-semibold text-zinc-100">Simulate Rule Update</h3>
          <div className="space-y-4 max-h-[68vh] overflow-y-auto pr-1">
            <label className="grid gap-1.5"><span className="text-xs text-zinc-500">Expression group mode</span>
              <div className="flex gap-2">
                {(['AND', 'OR'] as const).map((mode) => (
                  <button key={mode} type="button" onClick={() => setDraft((p) => ({ ...(p ?? form), expression_mode: mode }))} className={`rounded border px-3 py-1 text-xs ${form.expression_mode === mode ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300' : 'border-zinc-700 text-zinc-400'}`}>{mode}</button>
                ))}
              </div>
            </label>

            <label className="grid gap-1.5"><span className="text-xs text-zinc-500">Confidence weighting ({form.confidence_weight.toFixed(2)})</span>
              <input type="range" min={0} max={1} step={0.01} value={form.confidence_weight} onChange={(e) => setDraft((p) => ({ ...(p ?? form), confidence_weight: Number(e.target.value) }))} className="accent-cyan-500 w-full" />
            </label>

            <label className="grid gap-1.5"><span className="text-xs text-zinc-500">Risk Threshold ({form.risk_threshold.toFixed(2)})</span>
              <input type="range" min={0.3} max={0.95} step={0.01} value={form.risk_threshold} onChange={(e) => setDraft((p) => ({ ...(p ?? form), risk_threshold: Number(e.target.value) }))} className="accent-cyan-500 w-full" />
            </label>

            <label className="grid gap-1.5"><span className="text-xs text-zinc-500">Velocity Limit ({form.velocity_limit})</span>
              <input type="range" min={1} max={20} step={1} value={form.velocity_limit} onChange={(e) => setDraft((p) => ({ ...(p ?? form), velocity_limit: Number(e.target.value) }))} className="accent-cyan-500 w-full" />
            </label>

            <div className="grid gap-2">
              <span className="text-xs text-zinc-500">High-Risk Channels</span>
              <div className="flex flex-wrap gap-2">
                {CHANNEL_OPTIONS.map((ch) => {
                  const active = form.high_risk_channels.includes(ch)
                  return (
                    <button key={ch} type="button" onClick={() => toggleChannel(ch)} className={`rounded-lg border px-3 py-1.5 text-xs ${active ? 'border-amber-500/40 bg-amber-500/15 text-amber-300' : 'border-zinc-700 text-zinc-500'}`}>{ch}</button>
                  )
                })}
              </div>
            </div>

            {FEATURE_RULES.map(({ key, label, min, max, step }) => (
              <label key={String(key)} className="grid gap-1.5">
                <span className="text-xs text-zinc-500">{label}: {Number(form[key]).toFixed(step < 1 ? 2 : 0)}</span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={Number(form[key])}
                  onChange={(e) => setDraft((p) => ({ ...(p ?? form), [key]: Number(e.target.value) }))}
                  className="accent-cyan-500 w-full"
                />
              </label>
            ))}

            <div className="grid grid-cols-2 gap-2">
              <label className="rounded border border-zinc-800 bg-zinc-950/60 p-2 text-xs text-zinc-400 flex items-center gap-2">
                <input type="checkbox" checked={form.override_ml_score} onChange={(e) => setDraft((p) => ({ ...(p ?? form), override_ml_score: e.target.checked }))} />
                Override ML score
              </label>
              <label className="rounded border border-zinc-800 bg-zinc-950/60 p-2 text-xs text-zinc-400 flex items-center gap-2">
                <input type="checkbox" checked={form.shadow_mode} onChange={(e) => setDraft((p) => ({ ...(p ?? form), shadow_mode: e.target.checked }))} />
                Shadow mode rules
              </label>
              <label className="col-span-2 rounded border border-zinc-800 bg-zinc-950/60 p-2 text-xs text-zinc-400 flex items-center gap-2">
                <input type="checkbox" checked={form.analyst_approval_required} onChange={(e) => setDraft((p) => ({ ...(p ?? form), analyst_approval_required: e.target.checked }))} />
                Analyst approval workflow required
              </label>
            </div>

            <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-xs text-violet-200">
              Simulation on recent transactions: flagged {simulatedImpacts.flagged}/{simulatedImpacts.total} ({simulatedImpacts.flaggedPct.toFixed(1)}%)
            </div>

            <button type="button" disabled={evalState.status === 'pending'} onClick={() => void handleEval()} className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-500/20 px-4 py-2.5 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50">
              {evalState.status === 'pending' ? <><Spinner size="sm" /> Applying…</> : '⊛ Apply Simulation'}
            </button>
            {evalState.data && <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-300">✓ {evalState.data.note}</div>}
            <ErrorBanner message={evalState.error} />
          </div>
        </Panel>
      </div>

      <ToastContainer />
    </div>
  )
}
