// ---------------------------------------------------------------------------
// ModelOpsPage — schedule, drift, champion/challenger, actions, history.
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { KpiCard } from '../components/ui/KpiCard'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { SectionHeader } from '../components/ui/SectionHeader'
import { useApi } from '../hooks/useApi'
import { usePost } from '../hooks/usePost'
import type { ModelOpsOverviewResponse } from '../types/api'

interface ModelOpsPageProps {
  apiBase: string
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'now'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function driftSeverity(psi: number): { label: string; cls: string } {
  if (psi >= 0.20) return { label: 'CRITICAL', cls: 'text-red-400 border-red-500/40 bg-red-500/10' }
  if (psi >= 0.15) return { label: 'WARNING', cls: 'text-orange-400 border-orange-500/40 bg-orange-500/10' }
  if (psi >= 0.10) return { label: 'ELEVATED', cls: 'text-amber-400 border-amber-500/40 bg-amber-500/10' }
  return { label: 'STABLE', cls: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' }
}

export function ModelOpsPage({ apiBase }: ModelOpsPageProps) {
  const [ops, refreshOps] = useApi<ModelOpsOverviewResponse>(apiBase, '/model-ops/overview')
  const [promoteState, execPromote] = usePost<{ status: string; champion_version: string }>(apiBase, '/model-ops/promote')
  const [rollbackState, execRollback] = usePost<{ status: string; champion_version: string }>(apiBase, '/model-ops/rollback')
  const [retrainState, execRetrain] = usePost<{ status: string; challenger_version: string }>(apiBase, '/model-ops/retrain-now')
  const [showRollbackModal, setShowRollbackModal] = useState(false)
  const [liveCountdown, setLiveCountdown] = useState(0)

  const busy = promoteState.status === 'pending' || rollbackState.status === 'pending' || retrainState.status === 'pending'

  // Tick countdown every second
  useEffect(() => {
    const base = ops.data?.schedule?.countdown_seconds ?? 0
    setLiveCountdown(base)
    const timer = setInterval(() => setLiveCountdown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(timer)
  }, [ops.data?.schedule?.countdown_seconds])

  async function act(action: 'promote' | 'rollback' | 'retrain') {
    if (action === 'promote') await execPromote()
    else if (action === 'rollback') await execRollback()
    else await execRetrain()
    void refreshOps()
  }

  const data = ops.data
  const schedule = data?.schedule
  const drift = data?.drift
  const champion = data?.champion
  const challenger = data?.challenger
  const adaptive = data?.adaptive_learning
  const history = data?.history ?? []
  const artifacts = data?.artifacts ?? []

  const psiSeverity = drift ? driftSeverity(drift.psi) : null
  const prDelta = champion && challenger ? challenger.pr_auc - champion.pr_auc : null

  return (
    <div className="flex flex-col gap-6">
      {/* Rollback safety modal */}
      {showRollbackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[420px] rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-zinc-100">⚠ Confirm Rollback</h3>
            <p className="mt-3 text-sm text-zinc-400">
              This will revert the champion to{' '}
              <span className="font-mono text-amber-300">xgb_trained_external_v1</span>. All active inference
              will immediately use the rollback model. This action is audited and logged.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => { void act('rollback'); setShowRollbackModal(false) }}
                className="flex-1 rounded-lg border border-amber-500/30 bg-amber-500/15 py-2 text-sm font-medium text-amber-200 hover:bg-amber-500/25"
              >
                Confirm Rollback
              </button>
              <button
                type="button"
                onClick={() => setShowRollbackModal(false)}
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <SectionHeader
        title="Model Ops"
        subtitle="Retrain schedule, drift monitoring, champion/challenger lifecycle, and artifacts"
        action={
          <button
            type="button"
            onClick={() => void refreshOps()}
            className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-300 hover:text-cyan-200"
          >
            ↻ Refresh
          </button>
        }
      />

      {ops.loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : (
        <>
          {/* Schedule KPIs */}
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard
              label="Retrain Cadence"
              value={schedule ? `${schedule.interval_days}d` : null}
              accent="cyan"
            />
            <KpiCard
              label="Next Retrain In"
              value={schedule ? formatCountdown(liveCountdown) : null}
              sub={schedule?.next_retrain_at ? new Date(schedule.next_retrain_at).toLocaleString() : undefined}
              accent="violet"
            />
            <KpiCard
              label="Last Retrain"
              value={schedule?.last_retrain_at ? new Date(schedule.last_retrain_at).toLocaleDateString() : 'Never'}
              accent="cyan"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            {/* Drift metrics */}
            <Panel className="lg:col-span-4" glow="amber">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-300">Drift Metrics</h3>
                {psiSeverity && (
                  <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-wider ${psiSeverity.cls}`}>
                    {psiSeverity.label}
                  </span>
                )}
              </div>
              {drift ? (
                <div className="space-y-3">
                  {([
                    ['PSI', drift.psi],
                    ['Mean Shift', drift.mean_shift],
                    ['Variance Shift', drift.variance_shift],
                  ] as [string, number][]).map(([label, val]) => (
                    <div key={label}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-500">{label}</span>
                        <span className={`text-sm font-semibold tabular-nums ${val >= 0.15 ? 'text-red-400' : val >= 0.1 ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {val.toFixed(3)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className={`h-full rounded-full transition-all ${val >= 0.15 ? 'bg-red-500' : val >= 0.1 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.min(100, val * 500)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
                    <p className="text-zinc-500">Adaptive policy</p>
                    <p className="mt-1 font-medium">{adaptive?.policy ?? '—'}</p>
                    <p className="mt-1 text-zinc-600">threshold: {adaptive?.threshold ?? '—'}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-zinc-600">No drift data</p>
              )}
            </Panel>

            {/* Champion vs Challenger */}
            <Panel className="lg:col-span-5" glow="violet">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-300">Champion vs Challenger</h3>
                {prDelta !== null && (
                  <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold tabular-nums ${
                    prDelta > 0
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                      : prDelta < 0
                        ? 'border-red-500/40 bg-red-500/10 text-red-400'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-400'
                  }`}>
                    Δ {prDelta > 0 ? '+' : ''}{prDelta.toFixed(3)}
                  </span>
                )}
              </div>
              <div className="space-y-3">
                {[
                  { model: champion, role: 'Champion' },
                  { model: challenger, role: 'Challenger' },
                ].map(({ model: m, role }) => (
                  m && (
                    <div key={role} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs text-zinc-500">{role}</p>
                          <p className="mt-0.5 text-sm font-semibold text-zinc-100 truncate max-w-[200px]">{m.version}</p>
                        </div>
                        <Badge value={m.status} size="md" />
                      </div>
                      <div className="mt-3 flex gap-4">
                        <div>
                          <p className="text-[10px] text-zinc-600">PR-AUC</p>
                          <p className="text-xl font-bold text-violet-300">{m.pr_auc.toFixed(3)}</p>
                        </div>
                        <div className="ml-auto flex-1 self-end">
                          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                            <div
                              className="h-full rounded-full bg-violet-500/70 transition-all"
                              style={{ width: `${m.pr_auc * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                ))}
              </div>
            </Panel>

            {/* Actions */}
            <Panel className="lg:col-span-3">
              <h3 className="mb-4 text-sm font-semibold text-zinc-300">Actions</h3>
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act('retrain')}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/15 px-3 py-2.5 text-sm font-medium text-violet-200 transition hover:bg-violet-500/25 disabled:opacity-50"
                >
                  {retrainState.status === 'pending' ? <Spinner size="sm" /> : '⟳'} Retrain Now
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act('promote')}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-2.5 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/25 disabled:opacity-50"
                >
                  {promoteState.status === 'pending' ? <Spinner size="sm" /> : '↑'} Promote Challenger
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setShowRollbackModal(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/15 px-3 py-2.5 text-sm font-medium text-amber-200 transition hover:bg-amber-500/25 disabled:opacity-50"
                >
                  {rollbackState.status === 'pending' ? <Spinner size="sm" /> : '↩'} Rollback
                </button>
              </div>
              {(promoteState.error || rollbackState.error || retrainState.error) && (
                <ErrorBanner message={promoteState.error ?? rollbackState.error ?? retrainState.error} />
              )}
            </Panel>
          </div>

          {/* Retrain history */}
          <Panel>
            <h3 className="mb-4 text-base font-semibold text-zinc-100">Retrain History</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-zinc-500">
                    <th className="pb-2 pr-4 font-medium">Run ID</th>
                    <th className="pb-2 pr-4 font-medium">Candidate</th>
                    <th className="pb-2 pr-4 font-medium">Started</th>
                    <th className="pb-2 pr-4 font-medium">PR-AUC</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.id} className="border-b border-zinc-800/40 hover:bg-zinc-900/40">
                      <td className="py-2 pr-4 font-mono text-zinc-400">{item.id}</td>
                      <td className="py-2 pr-4 text-zinc-300 max-w-[200px] truncate">{item.candidate_version}</td>
                      <td className="py-2 pr-4 text-zinc-500">{new Date(item.started_at).toLocaleString()}</td>
                      <td className="py-2 pr-4 font-semibold text-violet-300 tabular-nums">{item.challenger_pr_auc.toFixed(3)}</td>
                      <td className="py-2">
                        <Badge value={item.promoted ? 'promoted' : 'shadow'} />
                      </td>
                    </tr>
                  ))}
                  {history.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-zinc-600">No retrain runs yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Artifacts */}
          <Panel>
            <h3 className="mb-4 text-base font-semibold text-zinc-100">Model Artifacts</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {artifacts.map((a) => (
                <div key={a.name} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <p className="text-sm font-semibold text-zinc-100">{a.name}</p>
                  <p className="mt-1 font-mono text-[10px] text-zinc-500 break-all">{a.path}</p>
                  <p className="mt-2 text-[10px] text-zinc-600">Updated: {new Date(a.updated_at).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}

      <ErrorBanner message={ops.error} />
    </div>
  )
}
