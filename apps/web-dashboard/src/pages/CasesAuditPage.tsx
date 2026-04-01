// ---------------------------------------------------------------------------
// CasesAuditPage — fraud cases with status filter + audit trail.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { SectionHeader } from '../components/ui/SectionHeader'
import { EmptyState } from '../components/ui/EmptyState'
import { useApi } from '../hooks/useApi'
import type { CaseListResponse, AuditListResponse, CaseStatus } from '../types/api'

interface CasesAuditPageProps {
  apiBase: string
}

const STATUSES: Array<CaseStatus | 'all'> = ['all', 'open', 'investigating', 'escalated', 'closed']

export function CasesAuditPage({ apiBase }: CasesAuditPageProps) {
  const [statusFilter, setStatusFilter] = useState<CaseStatus | 'all'>('all')

  const casesPath =
    statusFilter === 'all'
      ? '/cases-audit/list?limit=100'
      : `/cases-audit/list?status=${statusFilter}&limit=100`

  const [cases, refreshCases] = useApi<CaseListResponse>(apiBase, casesPath)
  const [audits, refreshAudits] = useApi<AuditListResponse>(apiBase, '/cases-audit/audits?limit=40')

  const caseItems = cases.data?.items ?? []
  const auditItems = audits.data?.items ?? []

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Cases & Audit Trail"
        subtitle="Open fraud cases, investigation queue, and immutable audit log"
        action={
          <button
            type="button"
            onClick={() => { void refreshCases(); void refreshAudits() }}
            className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-300 hover:text-cyan-200"
          >
            ↻ Refresh
          </button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Cases panel */}
        <Panel glow="red">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-zinc-100">
              Fraud Cases
              {cases.data && (
                <span className="ml-2 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                  {cases.data.total}
                </span>
              )}
            </h3>

            {/* Status filter */}
            <div className="flex flex-wrap gap-1">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    statusFilter === s
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {cases.loading ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : caseItems.length === 0 ? (
            <EmptyState message="No cases match the selected filter" />
          ) : (
            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {caseItems.map((c) => (
                <div
                  key={c.id}
                  className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-4 transition hover:border-zinc-700"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-100">{c.id}</p>
                      <p className="mt-0.5 font-mono text-xs text-zinc-500 truncate">{c.transaction_id}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge value={c.status} />
                      <Badge value={c.severity} />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[10px] text-zinc-600">
                    <span>Owner: <span className="text-zinc-400">{c.owner}</span></span>
                    <span>{new Date(c.updated_at).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <ErrorBanner message={cases.error} />
        </Panel>

        {/* Audit log */}
        <Panel>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-zinc-100">
              Audit Log
              {audits.data && (
                <span className="ml-2 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                  {audits.data.total}
                </span>
              )}
            </h3>
            {audits.loading && <Spinner size="sm" />}
          </div>

          {auditItems.length === 0 && !audits.loading ? (
            <EmptyState message="No audit records yet" />
          ) : (
            <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-1">
              {auditItems.map((a) => (
                <div
                  key={a.id}
                  className="rounded-lg border border-zinc-800/60 bg-zinc-950/60 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                        {a.actor}
                      </span>
                      <span className="text-xs text-zinc-300">{a.action}</span>
                    </div>
                    <span className="text-[10px] text-zinc-600 shrink-0">
                      {new Date(a.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-zinc-600 truncate">{a.target}</p>
                </div>
              ))}
            </div>
          )}
          <ErrorBanner message={audits.error} />
        </Panel>
      </div>
    </div>
  )
}
