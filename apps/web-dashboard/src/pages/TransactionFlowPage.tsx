// ---------------------------------------------------------------------------
// TransactionFlowPage — live scoring form + paginated recent-decision table.
// ---------------------------------------------------------------------------

import { useState } from 'react'
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
import type { TransactionFlowResponse, ScoreResponse } from '../types/api'

interface TransactionFlowPageProps {
  apiBase: string
}

const CHANNELS = ['card', 'wire', 'crypto', 'ach', 'upi'] as const

export function TransactionFlowPage({ apiBase }: TransactionFlowPageProps) {
  const [flow, refreshFlow] = useApi<TransactionFlowResponse>(apiBase, '/transaction-flow/recent?limit=40')
  const [scoreState, postScore] = usePost<ScoreResponse>(apiBase, '/score')
  const addToast = useToast()

  const [form, setForm] = useState({
    sender: 'demo_victim_01',
    receiver: 'demo_mule_ring_03',
    amount: '1250',
    channel: 'card',
    merchant: '',
    velocity: '2',
    beneficiaryAgeDays: '18',
    deviceFingerprint: 'device_hub_001',
  })
  
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [explainResult, setExplainResult] = useState<Record<string, number> | null>(null)

  const isFormValid = form.sender && form.receiver && form.amount

  async function handleScore() {
    if (!isFormValid) return
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
      // Toast notification based on fraud label
      if (result.label === 'fraud') {
        addToast(`⚠ Threat Intercepted — score ${(result.score * 100).toFixed(1)}% — ${result.decision}`, 'error')
      } else {
        addToast(`✓ Clear — score ${(result.score * 100).toFixed(1)}%`, 'success')
      }
      // Fetch SHAP-like explanation
      try {
        const explain = await apiPost<{ contributions: Record<string, number> }>(
          apiBase,
          '/explain',
          body,
        )
        setExplainResult(explain.contributions)
      } catch {
        setExplainResult(null)
      }
    }
  }

  const items = flow.data?.items ?? []
  const result = scoreState.data

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Transaction Flow"
        subtitle="Evaluate transactions live and inspect the decision trail"
      />

      <div className="grid gap-6 items-start lg:grid-cols-12">
        {/* Score form */}
        <Panel className="lg:col-span-4" glow="cyan">
          <div className="flex items-center justify-between mb-4">
             <h3 className="text-base font-semibold text-zinc-100">Evaluate Risk Pattern</h3>
             <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">{form.channel} • live</span>
          </div>
          <div className="grid gap-4">
            <label className="grid gap-1.5 focus-within:text-cyan-400 text-zinc-500 transition-colors">
              <span className="text-xs font-medium">Sender Identity</span>
              <select
                className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-cyan-500 hover:border-zinc-500 transition-colors shadow-inner"
                value={form.sender}
                onChange={(e) => setForm((p) => ({ ...p, sender: e.target.value }))}
              >
                {['demo_victim_01', 'demo_victim_02', 'demo_victim_03', 'demo_legit_001'].map((id) => (
                   <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5 focus-within:text-cyan-400 text-zinc-500 transition-colors">
              <div className="flex justify-between items-end">
                <span className="text-xs font-medium">Receiver Identity</span>
                {form.receiver.includes('mule') && <span className="text-[10px] text-amber-500 bg-amber-500/10 px-1.5 rounded animate-pulse">known risk</span>}
              </div>
              <select
                className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-cyan-500 hover:border-zinc-500 transition-colors shadow-inner"
                value={form.receiver}
                onChange={(e) => setForm((p) => ({ ...p, receiver: e.target.value }))}
              >
                {['demo_mule_ring_03', 'demo_mule_ring_08', 'sink_account_01', 'beneficiary_01'].map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5 focus-within:text-cyan-400 text-zinc-500 transition-colors">
              <span className="text-xs font-medium">Amount Confirmed ($)</span>
              <input
                type="number"
                min={0}
                className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2.5 text-sm font-medium text-zinc-100 outline-none focus:border-cyan-500 hover:border-zinc-500 transition-colors shadow-inner"
                value={form.amount}
                onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
              />
            </label>

            <div className="border-t border-zinc-800/80 pt-3 mt-1">
               <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="text-xs text-zinc-500 hover:text-zinc-300 font-medium transition-colors w-full text-left flex justify-between items-center">
                 <span>Advanced Threat Vectors</span>
                 <span>{showAdvanced ? '−' : '+'}</span>
               </button>
               
               {showAdvanced && (
                  <div className="grid gap-4 mt-4 animate-[fadeIn_.2s_ease_both]">
                    <div className="grid grid-cols-2 gap-4">
                      <label className="grid gap-1.5 focus-within:text-cyan-400 text-zinc-500 transition-colors">
                        <span className="text-xs">Channel</span>
                        <select
                          className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500"
                          value={form.channel}
                          onChange={(e) => setForm((p) => ({ ...p, channel: e.target.value }))}
                        >
                          {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </label>
                      <label className="grid gap-1.5 focus-within:text-cyan-400 text-zinc-500 transition-colors">
                        <span className="text-xs">Velocity (5m)</span>
                        <input
                          type="number" min={0} max={20}
                          className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500"
                          value={form.velocity}
                          onChange={(e) => setForm((p) => ({ ...p, velocity: e.target.value }))}
                        />
                      </label>
                    </div>

                    <label className="grid gap-1.5 focus-within:text-cyan-400 text-zinc-500 transition-colors">
                      <span className="text-xs">Merchant Category</span>
                      <input
                        type="text"
                        className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-700 outline-none focus:border-cyan-500"
                        placeholder="e.g. groceries"
                        value={form.merchant}
                        onChange={(e) => setForm((p) => ({ ...p, merchant: e.target.value }))}
                      />
                    </label>

                    <div className="grid grid-cols-2 gap-4">
                      <label className="grid gap-1.5 focus-within:text-cyan-400 text-zinc-500 transition-colors">
                        <span className="text-xs">Device Pattern</span>
                        <input
                          type="text"
                          className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500"
                          value={form.deviceFingerprint}
                          onChange={(e) => setForm((p) => ({ ...p, deviceFingerprint: e.target.value }))}
                        />
                      </label>
                      <label className="grid gap-1.5 focus-within:text-cyan-400 text-zinc-500 transition-colors">
                        <span className="text-xs">Age (days)</span>
                        <input
                          type="number" min={0} max={3650}
                          className="rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500"
                          value={form.beneficiaryAgeDays}
                          onChange={(e) => setForm((p) => ({ ...p, beneficiaryAgeDays: e.target.value }))}
                        />
                      </label>
                    </div>
                  </div>
               )}
            </div>

            <button
              type="button"
              disabled={scoreState.status === 'pending' || !isFormValid}
              onClick={() => void handleScore()}
              className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 px-4 py-3 text-sm font-bold text-zinc-950 transition-all disabled:opacity-50 disabled:bg-cyan-500/10 disabled:text-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.3)] hover:shadow-[0_0_20px_rgba(6,182,212,0.5)]"
            >
              {scoreState.status === 'pending' ? <><Spinner size="sm" className="text-zinc-950"/> Computing Risk Matrix…</> : '⚡ Evaluate Risk Pattern'}
            </button>
          </div>
          <ErrorBanner message={scoreState.error} />
        </Panel>

        {/* Result side panel */}
        {result && (
          <Panel className="lg:col-span-3 animate-[fadeIn_.4s_ease_both]" glow={result.decision === 'freeze' ? 'red' : 'emerald'}>
             <h3 className="text-base font-semibold text-zinc-100 mb-4">Evaluation Payload</h3>
             <div className="space-y-4">
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3 text-xs text-zinc-400 shadow-inner flex flex-col gap-1.5">
                  <div className="flex justify-between"><span className="text-zinc-500">Route</span><span className="font-mono text-cyan-300">{form.sender}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Target</span><span className="font-mono text-violet-300">{form.receiver}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Value</span><span className="text-zinc-200 font-medium">${form.amount}</span></div>
                </div>
                
                <div className="flex flex-col items-center gap-3 py-4 border-y border-zinc-800/60">
                  <ScoreRing score={result.score} size={88} />
                  <div className="flex items-center gap-2">
                    <Badge value={result.label} size="md" />
                    <span className="text-zinc-600 text-xs">→</span>
                    <Badge value={result.decision} size="md" />
                  </div>
                </div>

                {explainResult && (
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2">Primary Vectors</p>
                    {Object.entries(explainResult)
                      .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
                      .slice(0, 4)
                      .map(([feat, val], idx) => (
                        <div key={feat} className="flex items-center gap-2">
                          <span className="w-24 shrink-0 text-[10px] text-zinc-400 truncate">{feat}</span>
                          <div className="flex-1">
                            <AnimatedBar
                              value={Math.min(100, Math.abs(val) * 200)}
                              max={100}
                              color={val > 0 ? 'red' : 'emerald'}
                              height="h-1.5"
                              delay={idx * 40}
                            />
                          </div>
                          <span className={`w-8 text-right text-[10px] tabular-nums ${val > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                            {val > 0 ? '+' : ''}{val.toFixed(2)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}

                <div className="flex flex-col gap-2 pt-2">
                   <button
                     type="button"
                     className="w-full rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20 transition-colors"
                     onClick={() => { window.location.hash = '/graph-intelligence' }}
                   >
                     ↗ Explore Topology
                   </button>
                   {['freeze', 'hold'].includes(result.decision) && (
                     <button
                       type="button"
                       className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs font-semibold text-red-300 hover:bg-red-500/20 transition-colors"
                       onClick={() => { window.location.hash = '/cases-audit' }}
                     >
                       ⚑ Escalate to Operations
                     </button>
                   )}
                </div>
             </div>
          </Panel>
        )}

        {/* Recent decisions table */}
        <Panel className={result ? 'lg:col-span-5' : 'lg:col-span-8'}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-zinc-100">Live Decision Stream</h3>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                 <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                 <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-medium text-emerald-500">Watching {items.length} records</span>
            </div>
          </div>

          {items.length === 0 && !flow.loading ? (
            <EmptyState message="Evaluate your first transaction to populate the stream." />
          ) : (
            <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              {/* Header */}
              <div className="grid grid-cols-[1.5fr_1fr_auto_auto] gap-3 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-800/80 mb-2">
                <span>Identity Hash</span>
                <span>Context</span>
                <span>Score</span>
                <span>Matrix</span>
              </div>
              {items.map((item) => (
                <div
                  key={item.transaction_id ?? `row-${item.timestamp ?? ''}-${item.amount}`}
                  className="grid grid-cols-[1.5fr_1fr_auto_auto] items-center gap-3 rounded-lg bg-zinc-950/40 px-3 py-2.5 text-xs transition-colors hover:bg-zinc-800/40 cursor-pointer group"
                >
                  <div className="flex flex-col gap-0.5">
                    <p className="font-mono text-[11px] text-zinc-300 truncate w-32 group-hover:text-cyan-300 transition-colors">{item.transaction_id ?? 'unknown'}</p>
                    <p className="text-[10px] text-zinc-500">{new Date(item.timestamp).toLocaleTimeString()}</p>
                  </div>
                  <div className="flex flex-col gap-0.5">
                     <p className="text-[11px] font-medium text-zinc-200">${item.amount.toFixed(2)}</p>
                     <p className="text-[10px] text-zinc-500 uppercase">{item.channel}</p>
                  </div>
                  <div className="flex items-center justify-center">
                    <span className={`tabular-nums font-semibold ${item.score > 0.8 ? 'text-red-400' : item.score > 0.4 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {(item.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5 items-end">
                    <Badge value={item.label} />
                    <Badge value={item.decision} />
                  </div>
                </div>
              ))}
              {flow.loading && <div className="flex justify-center p-4"><Spinner size="sm" /></div>}
            </div>
          )}
        </Panel>
      </div>
      <ToastContainer />
    </div>
  )
}
