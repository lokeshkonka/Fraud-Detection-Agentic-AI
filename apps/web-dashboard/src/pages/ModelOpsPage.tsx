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
import { ToastContainer } from '../components/ui/Toast'
import { useToast } from '../hooks/useToast'
import { useApi } from '../hooks/useApi'
import { usePost } from '../hooks/usePost'
import type { ModelOpsOverviewResponse } from '../types/api'

interface ModelOpsPageProps {
  apiBase: string
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'Optimizing now…'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function relativeTime(dateString: string): string {
  const diff = Date.now() - new Date(dateString).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min${minutes > 1 ? 's' : ''} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr${hours > 1 ? 's' : ''} ago`
  return `${Math.floor(hours / 24)} day${Math.floor(hours / 24) > 1 ? 's' : ''} ago`
}

function driftSeverity(psi: number): { label: string; cls: string; desc: string } {
  if (psi >= 0.20) return { label: 'CRITICAL', cls: 'text-red-400 border-red-500/40 bg-red-500/10', desc: 'Retrain recommended' }
  if (psi >= 0.15) return { label: 'WARNING', cls: 'text-orange-400 border-orange-500/40 bg-orange-500/10', desc: 'Threshold approaching' }
  if (psi >= 0.10) return { label: 'ELEVATED', cls: 'text-amber-400 border-amber-500/40 bg-amber-500/10', desc: 'Monitoring variation' }
  return { label: 'STABLE', cls: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10', desc: 'Within tolerance' }
}

export function ModelOpsPage({ apiBase }: ModelOpsPageProps) {
  const [ops, refreshOps] = useApi<ModelOpsOverviewResponse>(apiBase, '/model-ops/overview')
  const [promoteState, execPromote] = usePost<{ status: string; champion_version: string }>(apiBase, '/model-ops/promote')
  const [rollbackState, execRollback] = usePost<{ status: string; champion_version: string }>(apiBase, '/model-ops/rollback')
  const [retrainState, execRetrain] = usePost<{ status: string; challenger_version: string }>(apiBase, '/model-ops/retrain-now')
  const [showRollbackModal, setShowRollbackModal] = useState(false)
  const [liveCountdown, setLiveCountdown] = useState(0)
  const addToast = useToast()

  const busy = promoteState.status === 'pending' || rollbackState.status === 'pending' || retrainState.status === 'pending'

  // Tick countdown every second
  useEffect(() => {
    const base = ops.data?.schedule?.countdown_seconds ?? 0
    setLiveCountdown(base)
    const timer = setInterval(() => setLiveCountdown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(timer)
  }, [ops.data?.schedule?.countdown_seconds])

  async function act(action: 'promote' | 'rollback' | 'retrain') {
    if (action === 'promote') {
       addToast('Promoting challenger to active champion...', 'info')
       await execPromote()
       addToast('Challenger successfully promoted. Inference routing updated.', 'success')
    } else if (action === 'rollback') {
       addToast('Rolling back to previous stable release...', 'info')
       await execRollback()
       addToast('Rollback complete. System utilizing known-stable baseline.', 'success')
    } else {
       addToast('Initiating out-of-band retrain cycle...', 'info')
       setLiveCountdown(0)
       await execRetrain()
       addToast('Retrain completed. Challenger PR-AUC updated.', 'success')
    }
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
    <div className="ml-dashboard flex flex-col gap-6">
      {/* Rollback safety modal */}
      {showRollbackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-[fadeIn_.2s_ease_both]">
          <div className="w-[min(92vw,460px)] rounded-2xl border border-amber-500/30 bg-zinc-950 p-6 shadow-[0_0_40px_rgba(245,158,11,0.15)]">
            <h3 className="text-lg font-bold text-amber-500 flex items-center gap-2">
               <span className="text-2xl">⚠</span> Confirm Emergency Rollback
            </h3>
            <div className="mt-4 text-sm text-zinc-400 space-y-3 leading-relaxed">
              <p>
                This will instantly demote the current champion and revert routing to the last known stable baseline:
              </p>
              <div className="rounded bg-zinc-900 border border-zinc-800 p-3 font-mono text-xs text-amber-300">
                Fallback targeting: xgb.joblib
              </div>
              <p>
                All active scoring operations will transition seamlessly. This action is immutable and logged to the global audit trail.
              </p>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => { void act('rollback'); setShowRollbackModal(false) }}
                className="flex-1 rounded-lg border border-amber-500 bg-amber-600 py-2.5 text-sm font-bold text-white hover:bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.4)] transition-all"
              >
                Execute Rollback
              </button>
              <button
                type="button"
                onClick={() => setShowRollbackModal(false)}
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                Cancel Process
              </button>
            </div>
          </div>
        </div>
      )}

      <SectionHeader
        title="Model Lifecycle & Drift Operations"
        subtitle="Operate retraining cadence, monitor drift, and control champion promotion safely."
        action={
          <button
            type="button"
            onClick={() => void refreshOps()}
            className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/60 px-4 py-2 text-sm font-medium text-zinc-300 hover:text-cyan-200 transition-colors"
          >
            ↻ Sync Model State
          </button>
        }
      />

      {ops.loading ? (
        <div className="animate-[shimmer_2s_infinite] bg-[linear-gradient(to_right,#00000000,#ffffff0a,#00000000)] bg-size-[400%_100%] space-y-6">
            <div className="grid gap-4 sm:grid-cols-3"><div className="h-28 rounded-xl bg-zinc-900/50" /><div className="h-28 rounded-xl bg-zinc-900/50" /><div className="h-28 rounded-xl bg-zinc-900/50" /></div>
          <div className="h-100 rounded-xl bg-zinc-900/50" />
         </div>
      ) : (
        <>
          {/* Schedule KPIs */}
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard
              label="Retrain Cadence"
              value={schedule ? `${schedule.interval_days} days` : null}
              accent="cyan"
            />
            <KpiCard
              label="Next Optimization Pass"
              value={schedule ? formatCountdown(liveCountdown) : null}
              sub={schedule?.next_retrain_at ? `Scheduled for ${new Date(schedule.next_retrain_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` : undefined}
              accent="violet"
            />
            <KpiCard
              label="Baseline Age"
              value={schedule?.last_retrain_at ? relativeTime(schedule.last_retrain_at) : 'Never'}
              sub={schedule?.last_retrain_at ? new Date(schedule.last_retrain_at).toLocaleDateString() : undefined}
              accent="emerald"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            {/* Champion vs Challenger */}
            <Panel className="lg:col-span-6 flex flex-col" glow="violet">
              <div className="mb-5 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-zinc-100">Performance Head-to-Head</h3>
                {prDelta !== null && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-zinc-500 font-medium">Challenger Edge</span>
                    <span className={`rounded border px-2 py-0.5 text-xs font-bold tabular-nums shadow-inner transition-colors ${
                      prDelta > 0
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                        : prDelta < 0
                          ? 'border-red-500/40 bg-red-500/10 text-red-400'
                          : 'border-zinc-700 bg-zinc-800 text-zinc-400'
                    }`}>
                      Δ {prDelta > 0 ? '+' : ''}{prDelta.toFixed(3)} AUC
                    </span>
                  </div>
                )}
              </div>
              <div className="space-y-4 flex-1">
                {[
                  { model: champion, role: 'Champion Network', isChamp: true, tag: 'live routing' },
                  { model: challenger, role: 'Challenger Network', isChamp: false, tag: 'shadow mode' },
                ].map(({ model: m, role, isChamp, tag }) => (
                  m && (
                    <div key={role} className={`group rounded-xl border p-5 transition-colors ${isChamp ? 'border-violet-500/30 bg-violet-500/5 hover:bg-violet-500/10' : 'border-zinc-800 bg-zinc-950/60 hover:bg-zinc-900'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                             <p className="text-sm font-bold text-zinc-200">{role}</p>
                              <span className={`rounded px-1.5 py-0.5 text-xs uppercase font-bold tracking-widest ${isChamp ? 'bg-violet-500 text-white' : 'bg-zinc-800 text-zinc-400'}`}>{tag}</span>
                          </div>
                            <p className="font-mono text-sm text-zinc-500 truncate max-w-60 mb-1">{m.version}</p>
                          <p className="text-xs text-zinc-600">Updated {schedule?.last_retrain_at ? relativeTime(schedule.last_retrain_at) : 'recently'}</p>
                        </div>
                        <Badge value={m.status} size="md" />
                      </div>
                      <div className="mt-4 space-y-1">
                        <div className="flex justify-between items-end">
                          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Precision-Recall AUC</p>
                          <p className={`text-2xl font-bold tabular-nums leading-none ${isChamp ? 'text-violet-300' : 'text-zinc-300'}`}>{m.pr_auc.toFixed(3)}</p>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800/80">
                          <div
                            className={`h-full rounded-full transition-all duration-1000 ${isChamp ? 'bg-violet-500 shadow-[0_0_10px_rgba(139,92,246,0.6)]' : 'bg-zinc-400'}`}
                            style={{ width: `${m.pr_auc * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  )
                ))}
              </div>
            </Panel>
            
            {/* Drift metrics */}
            <Panel className="lg:col-span-3 flex flex-col" glow="amber">
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-zinc-100 mb-1">Feature Drift Monitor</h3>
                <p className="text-sm text-zinc-500">Continuous population stability</p>
              </div>
              
              {drift && psiSeverity ? (
                <div className="flex flex-col gap-4 flex-1">
                  <div className={`rounded-xl border p-4 text-center shadow-inner ${psiSeverity.cls}`}>
                     <p className="text-xs font-bold uppercase tracking-widest mb-1 opacity-80">Global PSI Status</p>
                     <p className="text-xl font-black tracking-wide">{psiSeverity.label}</p>
                     <p className="text-xs uppercase font-semibold mt-1 opacity-80">{psiSeverity.desc}</p>
                  </div>
                  
                  <div className="space-y-4 mt-2">
                    {([
                      ['Population Stability', drift.psi],
                      ['Mean Target Shift', drift.mean_shift],
                      ['Variance Distortion', drift.variance_shift],
                    ] as [string, number][]).map(([label, val]) => {
                      const isHigh = val >= 0.15;
                      const isWarn = val >= 0.1;
                      return (
                      <div key={label} className="group">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-medium text-zinc-400 group-hover:text-zinc-300 transition-colors">{label}</span>
                          <span className={`text-[11px] font-bold tabular-nums px-1.5 rounded bg-zinc-950 border ${isHigh ? 'text-red-400 border-red-900' : isWarn ? 'text-amber-400 border-amber-900' : 'text-emerald-400 border-emerald-900'}`}>
                            {val.toFixed(3)}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-900 border border-zinc-800">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${isHigh ? 'bg-red-500' : isWarn ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(100, val * 500)}%` }}
                          />
                        </div>
                      </div>
                    )})}
                  </div>
                  
                  <div className="mt-auto pt-4 border-t border-zinc-800/80">
                    <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Automated Policy</p>
                      <div className="flex items-center justify-between text-sm">
                       <span className="text-zinc-300 font-medium">{adaptive?.policy ?? '—'}</span>
                       <span className="text-zinc-500">thr: <span className="text-zinc-400 font-mono">{adaptive?.threshold ?? '—'}</span></span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-sm text-zinc-600">No drift signals active</div>
              )}
            </Panel>

            {/* Actions */}
            <Panel className="lg:col-span-3">
              <h3 className="mb-1 text-lg font-semibold text-zinc-100">Operations Control</h3>
              <p className="mb-5 text-sm text-zinc-500">Execute manual overrides</p>
              
              <div className="space-y-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act('promote')}
                  className="group flex w-full flex-col items-center justify-center gap-1 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 transition-all hover:bg-emerald-500/20 hover:border-emerald-500/60 disabled:opacity-50"
                >
                  <span className="flex items-center gap-2 text-sm font-bold text-emerald-300">
                    {promoteState.status === 'pending' ? <Spinner size="sm" /> : '↑'} Promote Challenger
                  </span>
                  <span className="text-xs text-emerald-500/70 group-hover:text-emerald-400 transition-colors">Replace active champion</span>
                </button>
                
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act('retrain')}
                  className="group flex w-full flex-col items-center justify-center gap-1 rounded-xl border border-violet-500/30 bg-violet-500/10 p-4 transition-all hover:bg-violet-500/20 hover:border-violet-500/50 disabled:opacity-50"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-violet-300">
                    {retrainState.status === 'pending' ? <Spinner size="sm" /> : '⟳'} Force Retrain Pass
                  </span>
                  <span className="text-xs text-violet-500/70 group-hover:text-violet-400 transition-colors">Generate new challenger</span>
                </button>
                
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setShowRollbackModal(true)}
                  className="group flex w-full flex-col items-center justify-center gap-1 rounded-xl border border-amber-500/30 bg-zinc-950 p-4 transition-all hover:bg-amber-500/10 hover:border-amber-500/50 disabled:opacity-50"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-amber-500">
                    {rollbackState.status === 'pending' ? <Spinner size="sm" /> : '↩'} Emergency Rollback
                  </span>
                  <span className="text-xs text-zinc-500 group-hover:text-amber-500/70 transition-colors">Revert to stable</span>
                </button>
              </div>
              {(promoteState.error || rollbackState.error || retrainState.error) && (
                <div className="mt-4"><ErrorBanner message={promoteState.error ?? rollbackState.error ?? retrainState.error} /></div>
              )}
            </Panel>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Retrain history */}
            <Panel className="flex flex-col">
              <h3 className="mb-4 text-base font-semibold text-zinc-100 flex items-center gap-2">
                 Optimization Log
                 {history.length > 0 && <span className="bg-zinc-800 text-zinc-400 text-xs px-2 py-0.5 rounded-full">{history.length} cycles</span>}
              </h3>
              <div className="flex-1 overflow-x-auto border border-zinc-800/80 rounded-xl bg-zinc-950/40">
                <table className="ml-table w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-zinc-900 border-b border-zinc-800 text-xs uppercase font-semibold tracking-wider text-zinc-500">
                    <tr>
                      <th className="p-3">Run Hash</th>
                      <th className="p-3">Candidate Model</th>
                      <th className="p-3">Completion Time</th>
                      <th className="p-3">PR-AUC</th>
                      <th className="p-3">Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {history.map((item) => (
                      <tr key={item.id} className="hover:bg-zinc-800/30 transition-colors group">
                        <td className="p-3 font-mono text-xs text-zinc-500 group-hover:text-zinc-400">{item.id.slice(0, 8)}...</td>
                        <td className="p-3">
                           <span className="font-mono text-zinc-300 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">{item.candidate_version.split('_').slice(-2).join('_')}</span>
                        </td>
                        <td className="p-3 text-zinc-400">{relativeTime(item.started_at)}</td>
                        <td className="p-3 font-bold text-violet-300 tabular-nums">{item.challenger_pr_auc.toFixed(3)}</td>
                        <td className="p-3">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold uppercase tracking-widest ${item.promoted ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-zinc-800 text-zinc-500 border border-zinc-700'}`}>
                             {item.promoted ? 'promoted' : 'shadow'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {history.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-zinc-600">No optimization cycles recorded</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>

            {/* Artifacts */}
            <Panel className="flex flex-col">
              <h3 className="mb-4 text-base font-semibold text-zinc-100 flex items-center gap-2">
                 Compiled Artifacts
                 {artifacts.length > 0 && <span className="bg-zinc-800 text-zinc-400 text-xs px-2 py-0.5 rounded-full">{artifacts.length} blobs</span>}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {artifacts.map((a) => (
                  <div key={a.name} className="group rounded-xl border border-zinc-800/80 bg-zinc-950 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-900 cursor-pointer">
                    <div className="flex items-center justify-between mb-2">
                       <p className="text-sm font-bold text-zinc-200 group-hover:text-cyan-300 transition-colors">{a.name}</p>
                       <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-zinc-600 group-hover:text-cyan-400"><path d="M4 12V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M16 6L12 2L8 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 2V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                    <p className="font-mono text-xs text-zinc-500 break-all mb-3 line-clamp-1">{a.path}</p>
                    <p className="text-xs font-medium text-zinc-600">Last touched: {relativeTime(a.updated_at)}</p>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </>
      )}

      <ErrorBanner message={ops.error} />
      <ToastContainer />
    </div>
  )
}
