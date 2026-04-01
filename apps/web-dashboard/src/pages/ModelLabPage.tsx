// ---------------------------------------------------------------------------
// ModelLabPage — feature stats, accuracy curve, drift baseline, model info.
// ---------------------------------------------------------------------------

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

function barWidth(val: number, max: number): string {
  return `${Math.min(100, (val / max) * 100)}%`
}

export function ModelLabPage({ apiBase }: ModelLabPageProps) {
  const [modelLab, refreshModelLab] = useApi<ModelLabResponse>(apiBase, '/model-lab/overview')

  const model = modelLab.data?.model
  const featureStats = modelLab.data?.feature_stats ?? []
  const accuracyCurve = modelLab.data?.accuracy_curve ?? []
  const drift = modelLab.data?.drift_baseline

  const maxVariance = Math.max(...featureStats.map((f) => f.variance), 1)

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Model Lab"
        subtitle="Champion model metrics, feature distributions, accuracy curve, and drift baseline"
        action={
          <button
            type="button"
            onClick={() => void refreshModelLab()}
            className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-300 hover:text-cyan-200"
          >
            ↻ Refresh
          </button>
        }
      />

      {modelLab.loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : (
        <>
          {/* Model info KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Champion" value={model?.champion ?? '—'} accent="cyan" />
            <KpiCard label="Challenger" value={model?.challenger ?? '—'} accent="violet" />
            <KpiCard label="PR-AUC" value={model ? model.pr_auc.toFixed(3) : null} accent="emerald" />
            <KpiCard label="ROC-AUC" value={model ? model.roc_auc.toFixed(3) : null} accent="emerald" />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Feature stats */}
            <Panel glow="cyan">
              <h3 className="mb-4 text-base font-semibold text-zinc-100">Feature Distributions</h3>
              <div className="space-y-3">
                {featureStats.map((f) => (
                  <div key={f.feature}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-zinc-300">{f.feature}</span>
                      <span className="text-xs text-zinc-500">mean {f.mean.toFixed(2)} · var {f.variance.toFixed(2)}</span>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-cyan-500/70 transition-all"
                        style={{ width: barWidth(f.variance, maxVariance) }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            {/* Drift baseline */}
            <Panel glow="amber">
              <h3 className="mb-4 text-base font-semibold text-zinc-100">Drift Baseline</h3>
              {drift ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <p className="text-[10px] text-zinc-600">PSI</p>
                      <p className="mt-1 text-2xl font-bold text-amber-300">{drift.psi.toFixed(3)}</p>
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <p className="text-[10px] text-zinc-600">Fraud prevalence</p>
                      <p className="mt-1 text-2xl font-bold text-amber-300">{(drift.fraud_prevalence * 100).toFixed(2)}%</p>
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <p className="text-[10px] text-zinc-600">Mean shift</p>
                      <p className="mt-1 text-xl font-semibold text-amber-300">{drift.mean_shift_score.toFixed(3)}</p>
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <p className="text-[10px] text-zinc-600">Variance shift</p>
                      <p className="mt-1 text-xl font-semibold text-amber-300">{drift.variance_shift_score.toFixed(3)}</p>
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-600">Generated: {new Date(drift.generated_at).toLocaleString()}</p>
                </div>
              ) : (
                <p className="text-sm text-zinc-600">No drift data available</p>
              )}
            </Panel>
          </div>

          {/* Cumulative accuracy curve */}
          <Panel>
            <h3 className="mb-4 text-base font-semibold text-zinc-100">Cumulative Accuracy Curve</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-zinc-500">
                    <th className="pb-2 pr-4 font-medium">Samples (x)</th>
                    <th className="pb-2 pr-4 font-medium">Precision</th>
                    <th className="pb-2 pr-4 font-medium">Recall</th>
                    <th className="pb-2 pr-4 font-medium">Fraud Catch</th>
                    <th className="pb-2 font-medium">FP Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {accuracyCurve.map((pt) => (
                    <tr key={pt.x} className="border-b border-zinc-800/40 hover:bg-zinc-900/40">
                      <td className="py-2 pr-4 font-semibold text-cyan-300 tabular-nums">{pt.x.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-emerald-300 tabular-nums">{(pt.precision * 100).toFixed(1)}%</td>
                      <td className="py-2 pr-4 text-emerald-300 tabular-nums">{(pt.recall * 100).toFixed(1)}%</td>
                      <td className="py-2 pr-4 text-violet-300 tabular-nums">{(pt.fraud_catch * 100).toFixed(1)}%</td>
                      <td className="py-2 text-amber-300 tabular-nums">{(pt.fp_trend * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Visual bars with AnimatedBar + staggered entrance */}
            <div className="mt-6 space-y-2">
              {accuracyCurve.map((pt, idx) => (
                <div key={`bar-${pt.x}`} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-right text-[10px] text-zinc-600 tabular-nums">{pt.x.toLocaleString()}</span>
                  <div className="flex flex-1 flex-col gap-1">
                    <AnimatedBar
                      value={pt.precision * 100}
                      max={100}
                      color="emerald"
                      height="h-2"
                      delay={idx * 50}
                    />
                    <AnimatedBar
                      value={pt.fraud_catch * 100}
                      max={100}
                      color="violet"
                      height="h-2"
                      delay={idx * 50 + 25}
                    />
                  </div>
                </div>
              ))}
              <div className="flex gap-4 pt-1 text-[10px] text-zinc-600">
                <span><span className="inline-block h-2 w-4 rounded bg-emerald-500/60 mr-1 align-middle" />Precision</span>
                <span><span className="inline-block h-2 w-4 rounded bg-violet-500/60 mr-1 align-middle" />Fraud Catch</span>
              </div>
            </div>
          </Panel>
        </>
      )}
      <ErrorBanner message={modelLab.error} />
    </div>
  )
}
