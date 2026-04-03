import { useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { KpiCard } from '../components/ui/KpiCard'
import { AnimatedBar } from '../components/ui/AnimatedBar'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { SectionHeader } from '../components/ui/SectionHeader'
import { useApi } from '../hooks/useApi'
import type { ModelLabResponse } from '../types/api'

interface ModelLabPageProps {
  apiBase: string
}

const HEALTH_CONFIG = {
  healthy: { label: 'Healthy', text: 'text-emerald-300', bg: 'bg-emerald-500/20 border-emerald-500/40', dot: 'bg-emerald-400' },
  warning: { label: 'Monitor', text: 'text-amber-300', bg: 'bg-amber-500/20 border-amber-500/40', dot: 'bg-amber-400' },
  retrain_soon: { label: 'Retrain Needed', text: 'text-red-300', bg: 'bg-red-500/20 border-red-500/40', dot: 'bg-red-400' },
} as const

function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Unknown'
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  
  if (diffDays > 0) return `${diffDays}d ago`
  if (diffHours > 0) return `${diffHours}h ago`
  return 'Just now'
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `₹${(amount / 1_000_000).toFixed(1)}M`
  if (amount >= 1_000) return `₹${(amount / 1_000).toFixed(0)}K`
  return `₹${amount}`
}

function getDriftNarrative(psi: number): string {
  if (psi < 0.05) return 'Transaction patterns are stable. No significant changes detected.'
  if (psi < 0.1) return 'Minor shifts in transaction patterns. Continue monitoring.'
  if (psi < 0.2) return 'Moderate drift detected. Consider scheduling evaluation.'
  return 'Significant drift detected. Retraining recommended soon.'
}

function ModelHealthBadge({ health }: { health: 'healthy' | 'warning' | 'retrain_soon' }) {
  const config = HEALTH_CONFIG[health]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${config.bg} ${config.text}`}>
      <span className={`h-2 w-2 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  )
}

function MLDiagnosticsDrawer({ 
  isOpen, 
  onClose, 
  data 
}: { 
  isOpen: boolean
  onClose: () => void
  data: ModelLabResponse | null 
}) {
  if (!isOpen || !data) return null
  
  const { model, drift_baseline, feature_stats } = data
  const maxVariance = Math.max(...feature_stats.map(f => f.variance), 1)
  
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl overflow-y-auto bg-zinc-950 shadow-2xl lg:max-w-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/95 px-6 py-4 backdrop-blur">
          <h2 className="text-xl font-semibold text-zinc-100">ML Diagnostics</h2>
          <button
            onClick={onClose}
            aria-label="Close diagnostics drawer"
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="space-y-6 p-6">
          <section>
            <h3 className="mb-3 text-sm font-medium text-zinc-400">Model Performance</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                <p className="text-xs uppercase tracking-wider text-zinc-500">PR-AUC (Champion)</p>
                <p className="mt-1 text-2xl font-bold text-cyan-300">{model.champion_pr_auc.toFixed(4)}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                <p className="text-xs uppercase tracking-wider text-zinc-500">ROC-AUC (Champion)</p>
                <p className="mt-1 text-2xl font-bold text-cyan-300">{model.champion_roc_auc.toFixed(4)}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                <p className="text-xs uppercase tracking-wider text-zinc-500">PR-AUC (Challenger)</p>
                <p className="mt-1 text-2xl font-bold text-violet-300">{model.challenger_pr_auc.toFixed(4)}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                <p className="text-xs uppercase tracking-wider text-zinc-500">ROC-AUC (Challenger)</p>
                <p className="mt-1 text-2xl font-bold text-violet-300">{model.challenger_roc_auc.toFixed(4)}</p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-medium text-zinc-400">Raw Drift Metrics</h3>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-zinc-500">PSI</p>
                  <p className="mt-1 text-xl font-semibold text-amber-300">{drift_baseline.psi.toFixed(4)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-zinc-500">Mean Shift</p>
                  <p className="mt-1 text-xl font-semibold text-amber-300">{drift_baseline.mean_shift_score.toFixed(4)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-zinc-500">Variance Shift</p>
                  <p className="mt-1 text-xl font-semibold text-amber-300">{drift_baseline.variance_shift_score.toFixed(4)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-zinc-500">Fraud Prevalence</p>
                  <p className="mt-1 text-xl font-semibold text-amber-300">{(drift_baseline.fraud_prevalence * 100).toFixed(2)}%</p>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-medium text-zinc-400">Advanced Feature Statistics</h3>
            <div className="space-y-3">
              {feature_stats.map((f) => (
                <div key={f.feature} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-zinc-300">{f.human_label || f.feature}</span>
                    <span className="text-xs text-zinc-500">var: {f.variance.toFixed(4)}</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-violet-500/60 transition-all"
                      style={{ width: `${(f.variance / maxVariance) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function ConfidenceNarrative({ data }: { data: ModelLabResponse }) {
  const { business_metrics, drift_baseline } = data
  
  const narratives = [
    `Catches ${business_metrics.fraud_catch_rate}% of fraud in the top review queue`,
    `Drift within safe threshold (PSI: ${drift_baseline.psi.toFixed(3)})`,
    `Challenger not yet significantly better than current champion`,
    business_metrics.model_health === 'healthy' ? 'No urgent retrain required' : 'Monitor model health for changes',
  ]

  return (
    <Panel glow="cyan" className="border-cyan-500/20">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-500/10">
          <svg className="h-5 w-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-zinc-100">Why We Trust This Model</h3>
          <ul className="mt-3 space-y-2">
            {narratives.map((n, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                {n}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  )
}

function OperationalImpactCard({ metrics }: { metrics: ModelLabResponse['business_metrics'] }) {
  const impactItems = [
    { label: 'Daily Alerts', value: metrics.alerts_per_day.toLocaleString(), icon: 'bell' },
    { label: 'Fraud Caught/Day', value: metrics.estimated_fraud_caught_daily.toLocaleString(), icon: 'shield' },
    { label: 'Prevented Loss', value: formatCurrency(metrics.prevented_loss_estimate), icon: 'currency' },
    { label: 'Freeze Success', value: `${metrics.freeze_success_rate}%`, icon: 'lock' },
    { label: 'False Positive Rate', value: `${metrics.false_positive_rate}%`, icon: 'warning' },
    { label: 'Queue Size', value: metrics.analyst_queue_size.toString(), icon: 'users' },
  ]

  return (
    <Panel glow="violet">
      <h3 className="mb-4 text-base font-semibold text-zinc-100">Operational Impact</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {impactItems.map(item => (
          <div key={item.label} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="text-xs uppercase tracking-wider text-zinc-500">{item.label}</p>
            <p className="mt-1 text-lg font-bold text-violet-200">{item.value}</p>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function ModelCompetitionCard({ data }: { data: ModelLabResponse }) {
  const { model } = data
  const championGap = ((model.champion_pr_auc - model.challenger_pr_auc) / model.champion_pr_auc * 100)
  const isChallengerBetter = model.challenger_pr_auc > model.champion_pr_auc
  const isChallengerClose = Math.abs(model.challenger_pr_auc - model.champion_pr_auc) < 0.01

  return (
    <Panel className="border-violet-500/20">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-zinc-100">Model Competition</h3>
        {isChallengerBetter && isChallengerClose && (
          <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-xs text-violet-300">Promote Soon</span>
        )}
      </div>
      
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
          <div className="flex items-center gap-2">
            <span className="rounded bg-cyan-500/20 px-2 py-0.5 text-[11px] font-medium text-cyan-300">LIVE</span>
            <span className="text-xs font-medium text-zinc-300">Champion</span>
          </div>
          <p className="mt-2 text-sm font-semibold text-cyan-200">{model.champion}</p>
          <p className="mt-1 text-xl font-bold text-cyan-300">{(model.champion_pr_auc * 100).toFixed(1)}%</p>
          <p className="text-[11px] text-zinc-500">PR-AUC Score</p>
        </div>
        
        <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-4">
          <div className="flex items-center gap-2">
            <span className="rounded bg-violet-500/20 px-2 py-0.5 text-[11px] font-medium text-violet-300">STAGING</span>
            <span className="text-xs font-medium text-zinc-300">Challenger</span>
          </div>
          <p className="mt-2 text-sm font-semibold text-violet-200">{model.challenger}</p>
          <p className="mt-1 text-xl font-bold text-violet-300">{(model.challenger_pr_auc * 100).toFixed(1)}%</p>
          <p className="text-[11px] text-zinc-500">PR-AUC Score</p>
        </div>
      </div>
      
      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400">Performance Gap</span>
          <span className={`text-sm font-semibold ${isChallengerBetter ? 'text-emerald-300' : 'text-zinc-300'}`}>
            {isChallengerBetter ? '+' : ''}{((model.challenger_pr_auc - model.champion_pr_auc) * 100).toFixed(2)}%
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all ${isChallengerBetter ? 'bg-emerald-500' : 'bg-violet-500'}`}
            style={{ width: `${Math.min(100, Math.abs(championGap) * 50 + 20)}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">
          {isChallengerBetter
            ? 'Challenger outperforms champion. Ready for evaluation.'
            : 'Champion maintains lead. Challenger continues learning.'}
        </p>
      </div>
    </Panel>
  )
}

function BehaviorSnapshotCard({ behavior }: { behavior: ModelLabResponse['human_behavior'] }) {
  const items = [
    { label: 'Transaction Size', value: behavior.typical_transaction_size },
    { label: 'Velocity', value: behavior.common_velocity },
    { label: 'Sender Pattern', value: behavior.sender_balance_movement },
    { label: 'Network Activity', value: behavior.receiver_spike_behavior },
  ]

  return (
    <Panel>
      <h3 className="mb-4 text-base font-semibold text-zinc-100">Behavior Snapshot</h3>
      <div className="space-y-3">
        {items.map(item => (
          <div key={item.label} className="flex items-center justify-between rounded-lg border border-zinc-800/50 bg-zinc-950/30 p-3">
            <span className="text-sm text-zinc-400">{item.label}</span>
            <span className="font-medium text-cyan-200">{item.value}</span>
          </div>
        ))}
        <div className="mt-3 flex items-center justify-between rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
          <span className="text-sm text-zinc-400">Anomaly Intensity</span>
          <span className={`inline-flex items-center gap-1.5 font-medium ${
            behavior.anomaly_intensity === 'low' ? 'text-emerald-300' :
            behavior.anomaly_intensity === 'moderate' ? 'text-amber-300' : 'text-red-300'
          }`}>
            <span className={`h-2 w-2 rounded-full ${
              behavior.anomaly_intensity === 'low' ? 'bg-emerald-400' :
              behavior.anomaly_intensity === 'moderate' ? 'bg-amber-400' : 'bg-red-400'
            }`} />
            {behavior.anomaly_intensity.charAt(0).toUpperCase() + behavior.anomaly_intensity.slice(1)}
          </span>
        </div>
      </div>
    </Panel>
  )
}

function FraudReviewEfficiencyCard({ curve }: { curve: ModelLabResponse['accuracy_curve'] }) {
  const finalPoint = curve[curve.length - 1]
  
  const [selectedQueue, setSelectedQueue] = useState(10000)
  const selectedPoint = curve.find(p => p.x >= selectedQueue) || finalPoint

  return (
    <Panel glow="emerald" className="lg:col-span-2">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex-1">
          <h3 className="mb-1 text-base font-semibold text-zinc-100">Fraud Review Efficiency</h3>
          <p className="mb-4 text-sm text-zinc-400">
            Reviewing top <span className="font-semibold text-emerald-300">{selectedQueue.toLocaleString()}</span> highest-risk transactions
          </p>
          
          <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
            <p className="text-sm text-zinc-300">
              catches <span className="text-2xl font-bold text-emerald-300">{(selectedPoint.fraud_catch * 100).toFixed(0)}%</span> of all fraud
            </p>
            <p className="mt-1 text-sm text-zinc-300">
              while keeping <span className="font-semibold text-cyan-300">{(selectedPoint.precision * 100).toFixed(0)}%</span> queue precision
            </p>
          </div>
          
          <div className="mb-4">
            <label className="mb-2 block text-xs text-zinc-500">Adjust Review Queue Size</label>
            <input
              type="range"
              min={1000}
              max={50000}
              step={1000}
              value={selectedQueue}
              onChange={e => setSelectedQueue(Number(e.target.value))}
              className="w-full cursor-pointer accent-emerald-500"
            />
            <div className="mt-1 flex justify-between text-xs text-zinc-600">
              <span>1K</span>
              <span>10K</span>
              <span>50K</span>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-center">
              <p className="text-lg font-bold text-emerald-300">{(selectedPoint.fraud_catch * 100).toFixed(0)}%</p>
              <p className="text-xs text-zinc-500">Fraud Caught</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-center">
              <p className="text-lg font-bold text-cyan-300">{(selectedPoint.precision * 100).toFixed(0)}%</p>
              <p className="text-xs text-zinc-500">Queue Precision</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-center">
              <p className="text-lg font-bold text-amber-300">{(selectedPoint.fp_trend * 100).toFixed(1)}%</p>
              <p className="text-xs text-zinc-500">FP Burden</p>
            </div>
          </div>
        </div>
        
        <div className="flex-1">
          <h4 className="mb-3 text-sm font-medium text-zinc-400">Cumulative Performance</h4>
          <div className="space-y-2">
            {curve.slice(0, 5).map((pt, idx) => (
              <div key={pt.x} className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-right text-xs text-zinc-500 tabular-nums">{pt.x.toLocaleString()}</span>
                <div className="flex flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <AnimatedBar value={pt.precision * 100} max={100} color="cyan" height="h-1.5" delay={idx * 50} />
                    <span className="w-10 text-xs text-cyan-400">{(pt.precision * 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AnimatedBar value={pt.fraud_catch * 100} max={100} color="emerald" height="h-1.5" delay={idx * 50 + 25} />
                    <span className="w-10 text-xs text-emerald-400">{(pt.fraud_catch * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-zinc-600">
            <span><span className="mr-1 inline-block h-1.5 w-3 rounded bg-cyan-500/60 align-middle" />Precision</span>
            <span><span className="mr-1 inline-block h-1.5 w-3 rounded bg-emerald-500/60 align-middle" />Fraud Catch</span>
          </div>
        </div>
      </div>
    </Panel>
  )
}

function DataStabilityCard({ drift }: { drift: ModelLabResponse['drift_baseline'] }) {
  const narrative = getDriftNarrative(drift.psi)
  const transactionChange = drift.mean_shift_score > 0 ? `+${(drift.mean_shift_score * 100).toFixed(0)}%` : `${(drift.mean_shift_score * 100).toFixed(0)}%`
  const varianceLabel = drift.variance_shift_score < 0.2 ? 'Low' : drift.variance_shift_score < 0.5 ? 'Moderate' : 'High'
  const fraudRateNormal = drift.fraud_prevalence > 0.02 && drift.fraud_prevalence < 0.08

  return (
    <Panel glow="amber">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-zinc-100">Data Stability</h3>
          <p className="mt-1 text-sm text-zinc-400">{narrative}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
          drift.psi < 0.1 ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' :
          drift.psi < 0.2 ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' :
          'border-red-500/40 bg-red-500/10 text-red-300'
        }`}>
          {drift.psi < 0.1 ? 'Stable' : drift.psi < 0.2 ? 'Slight Shift' : 'Needs Retrain'}
        </span>
      </div>
      
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Transaction Pattern</p>
          <p className={`mt-1 text-lg font-bold ${drift.mean_shift_score > 0.1 ? 'text-amber-300' : 'text-emerald-300'}`}>
            {transactionChange}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Variance Drift</p>
          <p className={`mt-1 text-lg font-bold ${
            drift.variance_shift_score < 0.2 ? 'text-emerald-300' :
            drift.variance_shift_score < 0.5 ? 'text-amber-300' : 'text-red-300'
          }`}>
            {varianceLabel}
          </p>
        </div>
        <div className="col-span-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Fraud Rate Status</p>
          <p className={`mt-1 text-lg font-bold ${fraudRateNormal ? 'text-emerald-300' : 'text-amber-300'}`}>
            {fraudRateNormal ? 'Normal' : 'Changed'} ({(drift.fraud_prevalence * 100).toFixed(2)}%)
          </p>
        </div>
      </div>
      
      <button className="mt-3 w-full rounded-lg border border-zinc-800 bg-zinc-900/50 py-2 text-xs text-zinc-500 hover:border-zinc-700 hover:text-zinc-400">
        View Detailed Drift Analysis →
      </button>
    </Panel>
  )
}

export function ModelLabPage({ apiBase }: ModelLabPageProps) {
  const [modelLab, refreshModelLab] = useApi<ModelLabResponse>(apiBase, '/model-lab/overview')
  const [showDiagnostics, setShowDiagnostics] = useState(false)

  const data = modelLab.data
  const model = data?.model
  const business = data?.business_metrics
  const behavior = data?.human_behavior

  return (
    <div className="ml-dashboard flex flex-col gap-6">
      <SectionHeader
        title="Model Intelligence"
        subtitle="Understand model quality, drift, and operational impact at a glance."
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshModelLab()}
              className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-4 py-2 text-sm font-medium text-zinc-300 hover:text-cyan-200"
            >
              ↻ Refresh
            </button>
          </div>
        }
      />

      {modelLab.loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard
              label="Fraud Catch Rate"
              value={`${business?.fraud_catch_rate ?? 0}%`}
              sub="in top queue"
              accent="emerald"
              delay={0}
            />
            <KpiCard
              label="Queue Precision"
              value={`${business?.queue_precision ?? 0}%`}
              sub="top 10k quality"
              accent="cyan"
              delay={50}
            />
            <div className="sm:col-span-2 lg:col-span-1">
              <Panel delay={100} className="h-full">
                <p className="text-sm font-medium uppercase tracking-widest text-zinc-500">Model Health</p>
                <div className="mt-2">
                  <ModelHealthBadge health={business?.model_health ?? 'healthy'} />
                </div>
              </Panel>
            </div>
            <KpiCard
              label="Last Retrained"
              value={formatRelativeTime(model?.champion_last_retrained)}
              sub={model?.champion_last_retrained ? new Date(model.champion_last_retrained).toLocaleDateString() : 'Unknown'}
              accent="amber"
              animate={false}
              delay={150}
            />
            <KpiCard
              label="Champion Version"
              value={model?.champion ?? '—'}
              accent="violet"
              animate={false}
              delay={200}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <DataStabilityCard drift={data.drift_baseline} />
            <ModelCompetitionCard data={data} />
          </div>

          <FraudReviewEfficiencyCard curve={data.accuracy_curve} />

          <div className="grid gap-6 lg:grid-cols-2">
            <BehaviorSnapshotCard behavior={behavior!} />
            <OperationalImpactCard metrics={business!} />
          </div>

          <ConfidenceNarrative data={data} />

          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setShowDiagnostics(true)}
              className="rounded-lg border border-zinc-700 bg-zinc-800/40 px-6 py-3 text-base text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-100"
            >
              Open ML Diagnostics →
            </button>
          </div>

          <MLDiagnosticsDrawer
            isOpen={showDiagnostics}
            onClose={() => setShowDiagnostics(false)}
            data={data}
          />
        </>
      ) : null}
      <ErrorBanner message={modelLab.error} />
    </div>
  )
}
