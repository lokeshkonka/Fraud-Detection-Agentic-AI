import { useMemo, useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { ScoreRing } from '../components/ui/ScoreRing'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { SectionHeader } from '../components/ui/SectionHeader'
import { EmptyState } from '../components/ui/EmptyState'
import { AnimatedBar } from '../components/ui/AnimatedBar'
import { ToastContainer } from '../components/ui/Toast'
import { useToast } from '../hooks/useToast'
import { useApi } from '../hooks/useApi'
import { usePost } from '../hooks/usePost'
import { apiPost } from '../lib/api'
import type { ModelLabResponse, ScoreResponse, TransactionFlowResponse } from '../types/api'

interface TransactionFlowPageProps {
  apiBase: string
}

const CHANNELS = ['card', 'wire', 'crypto', 'ach', 'upi'] as const
const PIPELINE = [
  '1) transaction ingestion',
  '2) schema validation',
  '3) feature engineering',
  '4) rule engine pre-check',
  '5) XGBoost inference',
  '6) risk fusion layer',
  '7) threshold routing',
  '8) analyst queue optimization',
  '9) case generation',
  '10) feedback loop retraining signal',
]

export function TransactionFlowPage({ apiBase }: TransactionFlowPageProps) {
  const [flow, refreshFlow] = useApi<TransactionFlowResponse>(apiBase, '/transaction-flow/recent?limit=40')
  const [modelLab] = useApi<ModelLabResponse>(apiBase, '/model-lab/overview')
  const [scoreState, postScore] = usePost<ScoreResponse>(apiBase, '/score')
  const addToast = useToast()

  const [form, setForm] = useState({
    sender: 'demo_victim_01',
    receiver: 'demo_mule_ring_03',
    amount: '1250',
    channel: 'wire',
    merchant: '',
    velocity: '7',
    beneficiaryAgeDays: '18',
    deviceFingerprint: 'device_hub_001',
  })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [explainResult, setExplainResult] = useState<Record<string, number> | null>(null)
  const [activeStep, setActiveStep] = useState(0)
  const isFormValid = form.sender && form.receiver && form.amount

  async function handleScore() {
    if (!isFormValid) return
    setActiveStep(0)
    const advance = (step: number) => setTimeout(() => setActiveStep(step), step * 150)
    for (let i = 1; i <= 10; i += 1) advance(i)

    const body = {
      transaction_id: `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      user_id: form.sender,
      receiver_id: form.receiver,
      amount: Number(form.amount),
      merchant: form.merchant || null,
      channel: form.channel,
      timestamp: new Date().toISOString(),
      features: {
        velocity: Number(form.velocity),
        beneficiary_age_days: Number(form.beneficiaryAgeDays),
        device_fingerprint: form.deviceFingerprint,
      },
    }
    const result = await postScore(body)
    if (result) {
      void refreshFlow()
      if (result.label === 'fraud') addToast(`⚠ Threat Intercepted — score ${(result.score * 100).toFixed(1)}% — ${result.decision}`, 'error')
      else addToast(`✓ Clear — score ${(result.score * 100).toFixed(1)}%`, 'success')
      try {
        const explain = await apiPost<{ contributions: Record<string, number> }>(apiBase, '/explain', body)
        setExplainResult(explain.contributions)
      } catch {
        setExplainResult(null)
      }
    }
  }

  const items = flow.data?.items ?? []
  const result = scoreState.data
  const modelMetrics = modelLab.data?.model
  const business = modelLab.data?.business_metrics
  const drift = modelLab.data?.drift_baseline
  const topCurve = modelLab.data?.accuracy_curve?.slice(-1)?.[0]

  const artifactHighlights = useMemo(
    () => [
      ['Fraud capture curve', topCurve ? `${(topCurve.fraud_catch * 100).toFixed(1)}%` : '—'],
      ['PR-AUC', modelMetrics ? modelMetrics.champion_pr_auc.toFixed(3) : '—'],
      ['ROC-AUC', modelMetrics ? modelMetrics.champion_roc_auc.toFixed(3) : '—'],
      ['Queue precision', business ? `${(business.queue_precision * 100).toFixed(1)}%` : '—'],
      ['Drift PSI', drift ? drift.psi.toFixed(3) : '—'],
      ['Challenger ΔPR', modelMetrics ? `${((modelMetrics.challenger_pr_auc - modelMetrics.champion_pr_auc) * 100).toFixed(2)} pp` : '—'],
    ],
    [topCurve, modelMetrics, business, drift],
  )

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Transaction Flow"
        subtitle="Updated XGBoost behavior pipeline with risk fusion, queue optimization, and retraining feedback"
      />

      <Panel glow="violet">
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">Updated ML-aligned pipeline</h3>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          {PIPELINE.map((step, i) => (
            <div key={step} className={`rounded-lg border px-2.5 py-2 text-xs ${i <= activeStep ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200' : 'border-zinc-800 bg-zinc-950/50 text-zinc-500'}`}>
              {step}
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-6 items-start lg:grid-cols-12">
        <Panel className="lg:col-span-4" glow="cyan">
          <h3 className="text-base font-semibold text-zinc-100 mb-4">Evaluate Risk Pattern</h3>
          <div className="grid gap-4">
            <label className="grid gap-1.5 text-zinc-500"><span className="text-xs font-medium">Sender Identity</span>
              <select className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-cyan-500" value={form.sender} onChange={(e) => setForm((p) => ({ ...p, sender: e.target.value }))}>
                {['demo_victim_01', 'demo_victim_02', 'demo_victim_03', 'demo_legit_001'].map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-zinc-500"><span className="text-xs font-medium">Receiver Identity</span>
              <select className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-cyan-500" value={form.receiver} onChange={(e) => setForm((p) => ({ ...p, receiver: e.target.value }))}>
                {['demo_mule_ring_03', 'demo_mule_ring_08', 'sink_account_01', 'beneficiary_01'].map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-zinc-500"><span className="text-xs font-medium">Amount Confirmed ($)</span>
              <input type="number" min={0} className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-cyan-500" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} />
            </label>
            <button type="button" onClick={() => setShowAdvanced((s) => !s)} className="text-xs text-zinc-500 hover:text-zinc-300 text-left">{showAdvanced ? '− Hide' : '+ Show'} advanced feature inputs</button>
            {showAdvanced && (
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1.5 text-zinc-500"><span className="text-xs">Channel</span>
                    <select className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500" value={form.channel} onChange={(e) => setForm((p) => ({ ...p, channel: e.target.value }))}>
                      {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-zinc-500"><span className="text-xs">Velocity (5m)</span>
                    <input type="number" min={0} max={20} className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500" value={form.velocity} onChange={(e) => setForm((p) => ({ ...p, velocity: e.target.value }))} />
                  </label>
                </div>
                <label className="grid gap-1.5 text-zinc-500"><span className="text-xs">Merchant Category</span>
                  <input type="text" className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500" value={form.merchant} onChange={(e) => setForm((p) => ({ ...p, merchant: e.target.value }))} />
                </label>
              </div>
            )}
            <button type="button" disabled={scoreState.status === 'pending' || !isFormValid} onClick={() => void handleScore()} className="mt-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 px-4 py-2.5 text-sm font-bold text-zinc-950 disabled:opacity-50">
              {scoreState.status === 'pending' ? 'Computing Risk Matrix…' : '⚡ Evaluate Risk Pattern'}
            </button>
          </div>
          <ErrorBanner message={scoreState.error} />
        </Panel>

        {result && (
          <Panel className="lg:col-span-3" glow={result.decision === 'freeze' ? 'red' : 'emerald'}>
            <h3 className="text-base font-semibold text-zinc-100 mb-4">Evaluation Payload</h3>
            <div className="flex flex-col items-center gap-3 py-2 border-y border-zinc-800/60 mb-3">
              <ScoreRing score={result.score} size={88} />
              <div className="flex items-center gap-2">
                <Badge value={result.label} size="md" />
                <span className="text-zinc-600 text-xs">→</span>
                <Badge value={result.decision} size="md" />
              </div>
            </div>
            {explainResult && (
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2">SHAP preview</p>
                {Object.entries(explainResult).sort(([, a], [, b]) => Math.abs(b) - Math.abs(a)).slice(0, 4).map(([feat, val], idx) => (
                  <div key={feat} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 text-[10px] text-zinc-400 truncate">{feat}</span>
                    <div className="flex-1"><AnimatedBar value={Math.min(100, Math.abs(val) * 200)} max={100} color={val > 0 ? 'red' : 'emerald'} height="h-1.5" delay={idx * 40} /></div>
                    <span className={`w-8 text-right text-[10px] tabular-nums ${val > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{val > 0 ? '+' : ''}{val.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        )}

        <Panel className={result ? 'lg:col-span-5' : 'lg:col-span-8'}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-zinc-100">Live Decision Stream</h3>
            <span className="text-xs font-medium text-emerald-500">Watching {items.length} records</span>
          </div>
          {items.length === 0 && !flow.loading ? <EmptyState message="Evaluate your first transaction to populate the stream." /> : (
            <div className="space-y-1.5 max-h-125 overflow-y-auto pr-2">
              <div className="grid grid-cols-[1.5fr_1fr_auto_auto] gap-3 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-800/80 mb-2">
                <span>Identity Hash</span><span>Context</span><span>Score</span><span>Matrix</span>
              </div>
              {items.map((item) => (
                <div key={item.transaction_id ?? `row-${item.timestamp ?? ''}-${item.amount}`} className="grid grid-cols-[1.5fr_1fr_auto_auto] items-center gap-3 rounded-lg bg-zinc-950/40 px-3 py-2.5 text-xs">
                  <div><p className="font-mono text-[11px] text-zinc-300 truncate w-32">{item.transaction_id ?? 'unknown'}</p><p className="text-[10px] text-zinc-500">{item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : '—'}</p></div>
                  <div><p className="text-[11px] font-medium text-zinc-200">${item.amount.toFixed(2)}</p><p className="text-[10px] text-zinc-500 uppercase">{item.channel}</p></div>
                  <div><span className={`tabular-nums font-semibold ${item.score > 0.8 ? 'text-red-400' : item.score > 0.4 ? 'text-amber-400' : 'text-emerald-400'}`}>{(item.score * 100).toFixed(0)}%</span></div>
                  <div className="flex flex-col gap-1.5 items-end"><Badge value={item.label} /><Badge value={item.decision} /></div>
                </div>
              ))}
              {flow.loading && <div className="flex justify-center p-4"><Spinner size="sm" /></div>}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {artifactHighlights.map(([label, value]) => (
          <Panel key={label}>
            <p className="text-xs text-zinc-500">{label}</p>
            <p className="text-xl font-semibold text-cyan-200 mt-1">{value}</p>
          </Panel>
        ))}
      </div>

      <ToastContainer />
    </div>
  )
}
