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
    amount: '1250',
    channel: 'card',
    merchant: '',
    velocity: '2',
  })
  const [explainResult, setExplainResult] = useState<Record<string, number> | null>(null)

  async function handleScore() {
    const body = {
      transaction_id: `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      user_id: 'demo-user',
      amount: Number(form.amount),
      merchant: form.merchant || null,
      channel: form.channel,
      timestamp: new Date().toISOString(),
      features: { velocity: Number(form.velocity) },
    }
    const result = await postScore(body)
    if (result) {
      void refreshFlow()
      // Toast notification based on fraud label
      if (result.label === 'fraud') {
        addToast(`⚠ Fraud detected — score ${(result.score * 100).toFixed(1)}% — ${result.decision}`, 'error')
      } else {
        addToast(`✓ Transaction approved — score ${(result.score * 100).toFixed(1)}%`, 'success')
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
        subtitle="Score transactions live and inspect the decision trail"
      />

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Score form */}
        <Panel className="lg:col-span-2" glow="cyan">
          <h3 className="mb-4 text-base font-semibold text-zinc-100">Score a Transaction</h3>
          <div className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-xs text-zinc-500">Amount ($)</span>
              <input
                type="number"
                min={0}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/60"
                value={form.amount}
                onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
              />
            </label>

            <label className="grid gap-1">
              <span className="text-xs text-zinc-500">Channel</span>
              <select
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/60"
                value={form.channel}
                onChange={(e) => setForm((p) => ({ ...p, channel: e.target.value }))}
              >
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>

            <label className="grid gap-1">
              <span className="text-xs text-zinc-500">Merchant (optional)</span>
              <input
                type="text"
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-700 outline-none focus:border-cyan-500/60"
                placeholder="e.g. groceries"
                value={form.merchant}
                onChange={(e) => setForm((p) => ({ ...p, merchant: e.target.value }))}
              />
            </label>

            <label className="grid gap-1">
              <span className="text-xs text-zinc-500">Velocity (txns / 5 min)</span>
              <input
                type="number"
                min={0}
                max={20}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/60"
                value={form.velocity}
                onChange={(e) => setForm((p) => ({ ...p, velocity: e.target.value }))}
              />
            </label>

            <button
              type="button"
              disabled={scoreState.status === 'pending'}
              onClick={() => void handleScore()}
              className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-cyan-500/20 px-4 py-2.5 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/30 disabled:opacity-50"
            >
              {scoreState.status === 'pending' ? <><Spinner size="sm" /> Scoring…</> : '⚡ Score Transaction'}
            </button>
          </div>

          {/* Result */}
          {result && (
            <div className="mt-5 space-y-3 border-t border-zinc-800 pt-4">
              <div className="flex items-center gap-4">
                <ScoreRing score={result.score} size={72} />
                <div className="space-y-1">
                  <Badge value={result.label} size="md" />
                  <p className="text-xs text-zinc-500">decision:</p>
                  <Badge value={result.decision} size="md" />
                </div>
              </div>
              {result.reasons.length > 0 && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2">
                  <p className="mb-1.5 text-xs text-zinc-500">Risk signals</p>
                  <div className="flex flex-wrap gap-1">
                    {result.reasons.map((r) => (
                      <span key={r} className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">{r}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SHAP explanation */}
          {explainResult && (
            <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <p className="mb-2 text-xs font-medium text-zinc-400">Feature contributions</p>
              <div className="space-y-2">
                {Object.entries(explainResult)
                  .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
                  .slice(0, 8)
                  .map(([feat, val], idx) => (
                    <div key={feat} className="flex items-center gap-2">
                      <span className="w-32 shrink-0 text-[10px] text-zinc-500 truncate">{feat}</span>
                      <div className="flex-1">
                        <AnimatedBar
                          value={Math.min(100, Math.abs(val) * 200)}
                          max={100}
                          color={val > 0 ? 'red' : 'emerald'}
                          height="h-1.5"
                          delay={idx * 40}
                        />
                      </div>
                      <span className={`w-12 text-right text-[10px] tabular-nums ${val > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                        {val > 0 ? '+' : ''}{val.toFixed(3)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <ErrorBanner message={scoreState.error} />
        </Panel>

        {/* Recent decisions table */}
        <Panel className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-zinc-100">Recent Decisions</h3>
            <div className="flex items-center gap-2">
              {flow.loading && <Spinner size="sm" />}
              <span className="text-xs text-zinc-600">{items.length} records</span>
            </div>
          </div>

          {items.length === 0 && !flow.loading ? (
            <EmptyState message="Score your first transaction above" />
          ) : (
            <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-1">
              {/* Header */}
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                <span>Transaction</span>
                <span>Channel</span>
                <span>Score</span>
                <span>Label</span>
                <span>Decision</span>
              </div>
              {items.map((item) => (
                <div
                  key={item.transaction_id ?? `row-${item.timestamp ?? ''}-${item.amount}`}
                  className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2 rounded-lg border border-zinc-800/60 bg-zinc-950/60 px-3 py-2 text-xs transition hover:border-zinc-700"
                >
                  <div>
                    <p className="font-mono text-[10px] text-zinc-400 truncate">{item.transaction_id ?? 'unknown'}</p>
                    <p className="text-[10px] text-zinc-600">${item.amount.toFixed(2)}</p>
                  </div>
                  <span className="text-zinc-400">{item.channel}</span>
                  <span className="tabular-nums text-zinc-300">{(item.score * 100).toFixed(0)}%</span>
                  <Badge value={item.label} />
                  <Badge value={item.decision} />
                </div>
              ))}
            </div>
          )}
          <ErrorBanner message={flow.error} />
        </Panel>
      </div>
      <ToastContainer />
    </div>
  )
}
