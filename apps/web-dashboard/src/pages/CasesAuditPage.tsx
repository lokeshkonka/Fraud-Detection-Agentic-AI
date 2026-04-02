// ---------------------------------------------------------------------------
// CasesAuditPage — Operations investigation console
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { SectionHeader } from '../components/ui/SectionHeader'
import { ToastContainer } from '../components/ui/Toast'
import { useToast } from '../hooks/useToast'
import { useApi } from '../hooks/useApi'
import type { CaseListResponse, AuditListResponse, CaseStatus } from '../types/api'

interface CasesAuditPageProps {
  apiBase: string
}

const STATUSES: Array<CaseStatus | 'all'> = ['all', 'open', 'investigating', 'escalated', 'closed']
const SEVERITIES = ['all', 'critical', 'high', 'medium', 'low']

export function CasesAuditPage({ apiBase }: CasesAuditPageProps) {
  const [statusFilter, setStatusFilter] = useState<CaseStatus | 'all'>('open')
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null)
  const [selectedCases, setSelectedCases] = useState<Set<string>>(new Set())

  const casesPath =
    statusFilter === 'all'
      ? '/cases-audit/list?limit=100'
      : `/cases-audit/list?status=${statusFilter}&limit=100`

  const [cases, refreshCases] = useApi<CaseListResponse>(apiBase, casesPath)
  const [audits, refreshAudits] = useApi<AuditListResponse>(apiBase, '/cases-audit/audits?limit=40')
  const addToast = useToast()

  const caseItems = (cases.data?.items ?? []).filter(c => severityFilter === 'all' || c.severity === severityFilter)
  const auditItems = audits.data?.items ?? []

  const handleBulkAction = (action: string) => {
    addToast(`${action} applied to ${selectedCases.size} selected cases.`, 'success')
    setSelectedCases(new Set())
  }

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const newSet = new Set(selectedCases)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    setSelectedCases(newSet)
  }

  return (
    <div className="flex flex-col gap-6 h-full">
      <SectionHeader
        title="Operations Investigations"
        subtitle="Analyst workspace for case triaging, bulk actions and compliance audit logs"
        action={
          <div className="flex items-center gap-3">
             <button
               type="button"
               disabled={selectedCases.size === 0}
               className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-30 disabled:border-zinc-800 disabled:text-zinc-600 disabled:bg-zinc-900 transition-colors"
               onClick={() => handleBulkAction('Global Freeze')}
             >
               🧊 Bulk Freeze
             </button>
             <button
               type="button"
               disabled={selectedCases.size === 0}
               className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-xs font-semibold text-violet-300 hover:bg-violet-500/20 disabled:opacity-30 disabled:border-zinc-800 disabled:text-zinc-600 disabled:bg-zinc-900 transition-colors"
               onClick={() => handleBulkAction('Assign to Me')}
             >
               + Assign Selected
             </button>
             <button
               type="button"
               onClick={() => { void refreshCases(); void refreshAudits() }}
               className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-4 py-2 text-xs font-medium text-zinc-300 hover:text-cyan-200 transition-colors"
             >
               ↻ Sync State
             </button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-12 h-full">
        {/* Cases panel */}
        <Panel glow="red" className="lg:col-span-8 flex flex-col p-0 overflow-hidden">
          <div className="sticky top-0 z-10 bg-zinc-900/80 backdrop-blur border-b border-zinc-800/80 p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                 <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                   Active Queue
                 </h3>
                 {cases.data && (
                    <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-bold font-mono text-zinc-400 border border-zinc-700 shadow-inner">
                      {caseItems.length} records
                    </span>
                 )}
                 {selectedCases.size > 0 && (
                    <span className="ml-2 text-xs text-violet-400 font-medium">
                      {selectedCases.size} selected
                    </span>
                 )}
              </div>
              <div className="flex items-center gap-4">
                 <div className="flex flex-col gap-1 items-end">
                    <span className="text-[9px] uppercase tracking-widest text-zinc-500 font-semibold">Severity</span>
                    <div className="flex gap-1">
                      {SEVERITIES.map((s) => (
                         <button
                           key={s} onClick={() => setSeverityFilter(s)}
                           className={`rounded px-2 py-0.5 text-[10px] uppercase font-bold transition-colors border ${severityFilter === s ? 'bg-zinc-700 border-zinc-500 text-zinc-100' : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}
                         >
                           {s}
                         </button>
                      ))}
                    </div>
                 </div>
                 <div className="flex flex-col gap-1 items-end border-l border-zinc-800 pl-4">
                    <span className="text-[9px] uppercase tracking-widest text-zinc-500 font-semibold">Status</span>
                    <select
                      className="rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[10px] uppercase font-bold text-zinc-300 outline-none focus:border-cyan-500 shadow-inner"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as CaseStatus | 'all')}
                    >
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                 </div>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar bg-zinc-950/20">
            {cases.loading ? (
              <div className="flex justify-center py-12"><Spinner /></div>
            ) : caseItems.length === 0 ? (
              <div className="py-20 flex justify-center opacity-50">
                 <div className="h-32 border border-dashed border-zinc-800 rounded-xl bg-zinc-950/50 flex flex-col items-center justify-center gap-2 text-zinc-500 px-12">
                   <p className="text-xs font-medium">No investigations in current view.</p>
                 </div>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/50">
                {caseItems.map((c) => {
                  const isExpanded = expandedCaseId === c.id
                  const isSelected = selectedCases.has(c.id)
                  
                  return (
                  <div key={c.id} className={`group flex flex-col transition-colors ${isSelected ? 'bg-violet-900/10' : 'hover:bg-zinc-800/30'}`}>
                    <div 
                      className={`grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-4 p-4 cursor-pointer focus:outline-none focus:bg-zinc-800/50`}
                      onClick={() => setExpandedCaseId(isExpanded ? null : c.id)}
                      tabIndex={0}
                    >
                      <button onClick={(e) => toggleSelect(c.id, e)} className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-violet-500 border-violet-500 text-white' : 'border-zinc-600 group-hover:border-zinc-400'}`}>
                         {isSelected && <svg viewBox="0 0 14 14" fill="none" className="w-3 h-3"><path d="M3 7.5L5.5 10L11 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </button>
                      
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className={`text-sm font-bold ${c.status === 'open' ? 'text-zinc-100' : 'text-zinc-400'}`}>{c.id}</p>
                          <span className="text-[10px] text-zinc-500">12 mins ago</span>
                        </div>
                        <p className="font-mono text-[10px] text-zinc-500 truncate group-hover:text-cyan-400 transition-colors">tx: {c.transaction_id.slice(0,18)}...</p>
                      </div>

                      <div className="flex items-center gap-2 w-28">
                         <div className="flex items-center justify-center h-6 w-6 rounded-full bg-zinc-800 border border-zinc-700 text-[10px] font-bold text-zinc-300">
                           {c.owner === 'unassigned' ? '?' : c.owner.substring(0, 2).toUpperCase()}
                         </div>
                         <span className="text-[10px] uppercase text-zinc-500 truncate max-w-[60px]">{c.owner}</span>
                      </div>

                      <div className="w-24 text-right">
                        <Badge value={c.severity} size="md" />
                      </div>
                      <div className="w-24 text-right">
                        <Badge value={c.status} size="md" />
                      </div>
                    </div>

                    {/* Expandable Drawer */}
                    {isExpanded && (
                      <div className="border-t border-zinc-800/40 bg-zinc-900/40 px-12 py-5 shadow-inner animate-[fadeIn_.2s_ease_both]">
                        <div className="grid grid-cols-2 gap-8">
                           <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Investigation Tools</p>
                              <div className="flex gap-2">
                                <button className="flex-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20" onClick={() => {window.location.hash = '/graph-intelligence'}}>Explore Context Graph</button>
                                <button className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-700">Audit Deep-link</button>
                              </div>
                           </div>
                           <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Data Operations</p>
                              <div className="flex gap-2">
                                <button className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-700">Export Case JSON</button>
                                {c.owner === 'unassigned' ? (
                                   <button className="flex-1 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-300 hover:bg-violet-500/20">Claim Case</button>
                                ) : (
                                   <button className="flex-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/20">Freeze Accounts</button>
                                )}
                              </div>
                           </div>
                        </div>
                      </div>
                    )}
                  </div>
                )})}
              </div>
            )}
          </div>
          <ErrorBanner message={cases.error} />
        </Panel>

        {/* Audit log */}
        <Panel className="lg:col-span-4 p-0 overflow-hidden flex flex-col border border-zinc-800">
          <div className="bg-zinc-900/80 border-b border-zinc-800/80 p-4 sticky top-0 z-10 shadow-sm flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              System Audit Trail
              {audits.data && (
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
                  {audits.data.total}
                </span>
              )}
            </h3>
            {audits.loading && <Spinner size="sm" />}
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar bg-zinc-950 p-2 space-y-1">
            {auditItems.length === 0 && !audits.loading ? (
              <EmptyState message="No audit records yet" />
            ) : (
               auditItems.map((a) => (
                <div
                  key={a.id}
                  className="rounded border border-zinc-800/40 bg-zinc-900/40 px-3 py-2.5 transition-colors hover:border-zinc-700 hover:bg-zinc-800/60 cursor-crosshair"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase font-bold text-zinc-400 shadow-[inset_0_1px_rgba(255,255,255,0.1)]">
                        {a.actor}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                      {new Date(a.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-300 font-medium mb-1">Performed <span className="text-zinc-100">{a.action}</span></p>
                  <p className="font-mono text-[9px] text-zinc-600 truncate break-all group-hover:text-cyan-400 transition-colors">tgt: {a.target}</p>
                </div>
              ))
            )}
          </div>
          <ErrorBanner message={audits.error} />
        </Panel>
      </div>
      <ToastContainer />
    </div>
  )
}
