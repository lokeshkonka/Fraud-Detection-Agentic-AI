import { useMemo, useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Spinner } from '../components/ui/Spinner'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { EmptyState } from '../components/ui/EmptyState'
import { SectionHeader } from '../components/ui/SectionHeader'
import { ToastContainer } from '../components/ui/Toast'
import { useToast } from '../hooks/useToast'
import { useApi } from '../hooks/useApi'
import { apiPost } from '../lib/api'
import type { AuditListResponse, CaseCommentRecord, CaseEventRecord, CaseListResponse, CaseStatus } from '../types/api'

interface CasesAuditPageProps {
  apiBase: string
}

const STATUSES: Array<CaseStatus | 'all'> = ['all', 'open', 'investigating', 'escalated', 'closed']
const SEVERITIES = ['all', 'critical', 'high', 'medium', 'low']

export function CasesAuditPage({ apiBase }: CasesAuditPageProps) {
  const [statusFilter, setStatusFilter] = useState<CaseStatus | 'all'>('open')
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [analystFilter, setAnalystFilter] = useState<string>('all')
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [commentBusy, setCommentBusy] = useState(false)
  const [attachmentDraft, setAttachmentDraft] = useState({ filename: '', payload: '' })
  const addToast = useToast()

  const casesPath = statusFilter === 'all' ? '/cases-audit/list?limit=100' : `/cases-audit/list?status=${statusFilter}&limit=100`
  const [cases, refreshCases] = useApi<CaseListResponse>(apiBase, casesPath)
  const [audits, refreshAudits] = useApi<AuditListResponse>(apiBase, '/cases-audit/audits?limit=80')
  const [queueStream, refreshQueue] = useApi<{ items: Array<{ case_id: string; queue_priority_score: number }> }>(apiBase, '/cases-audit/queue/stream')
  const [events, refreshEvents] = useApi<{ items: CaseEventRecord[] }>(apiBase, expandedCaseId ? `/cases-audit/cases/${expandedCaseId}/events` : '/cases-audit/cases/none/events')
  const [comments, refreshComments] = useApi<{ items: CaseCommentRecord[] }>(apiBase, expandedCaseId ? `/cases-audit/cases/${expandedCaseId}/comments` : '/cases-audit/cases/none/comments')

  const caseItems = useMemo(() => {
    const bySeverity = (cases.data?.items ?? []).filter((c) => severityFilter === 'all' || c.severity === severityFilter)
    const byAnalyst = bySeverity.filter((c) => analystFilter === 'all' || c.owner === analystFilter)
    const qMap = new Map((queueStream.data?.items ?? []).map((q) => [q.case_id, q.queue_priority_score]))
    return byAnalyst.map((c) => ({ ...c, queue_priority_score: qMap.get(c.id) ?? 0 }))
  }, [cases.data?.items, queueStream.data?.items, severityFilter, analystFilter])

  const selectedCase = caseItems.find((c) => c.id === expandedCaseId) ?? null

  async function runAction(caseId: string, action: 'freeze' | 'escalate' | 'close' | 'assign') {
    try {
      await apiPost(apiBase, `/cases-audit/cases/${caseId}/actions`, { action, owner: 'fraud-ops', reason: `manual_${action}` })
      addToast(`Case ${caseId}: ${action} action completed.`, 'success')
      await refreshCases()
      await refreshAudits()
      await refreshQueue()
      if (expandedCaseId === caseId) await refreshEvents()
    } catch (e) {
      addToast(e instanceof Error ? e.message : `${action} failed`, 'error')
    }
  }

  async function addComment() {
    if (!expandedCaseId || !commentDraft.trim()) return
    setCommentBusy(true)
    try {
      await apiPost(apiBase, `/cases-audit/cases/${expandedCaseId}/comments`, { author: 'fraud-analyst', message: commentDraft })
      setCommentDraft('')
      await refreshComments()
      await refreshEvents()
      addToast('Case note added.', 'success')
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Comment failed', 'error')
    } finally {
      setCommentBusy(false)
    }
  }

  async function uploadAttachment() {
    if (!expandedCaseId || !attachmentDraft.filename.trim()) return
    try {
      await apiPost(apiBase, `/cases-audit/cases/${expandedCaseId}/attachments`, { author: 'fraud-analyst', filename: attachmentDraft.filename, payload: attachmentDraft.payload, content_type: 'text/plain' })
      setAttachmentDraft({ filename: '', payload: '' })
      await refreshEvents()
      addToast('Attachment uploaded.', 'success')
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Attachment failed', 'error')
    }
  }

  async function exportAudits(format: 'csv' | 'json') {
    window.open(`${apiBase}/cases-audit/audits/export?format=${format}`, '_blank')
  }

  const analysts = useMemo(() => ['all', ...Array.from(new Set((cases.data?.items ?? []).map((c) => c.owner)))], [cases.data?.items])

  return (
    <div className="flex flex-col gap-6 h-full">
      <SectionHeader
        title="Operations Investigations"
        subtitle="Case queue, SLA-aware triage, notes, evidence timeline, and immutable governance auditability"
        action={
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => exportAudits('csv')} className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-300">Export CSV</button>
            <button type="button" onClick={() => exportAudits('json')} className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-300">Export JSON</button>
            <button type="button" onClick={() => { void refreshCases(); void refreshAudits(); void refreshQueue() }} className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-300">↻ Sync State</button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-12 h-full">
        <Panel glow="red" className="lg:col-span-7 flex flex-col p-0 overflow-hidden">
          <div className="sticky top-0 z-10 bg-zinc-900/80 backdrop-blur border-b border-zinc-800/80 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-zinc-100">Case Queue <span className="text-xs text-zinc-500">({caseItems.length})</span></h3>
              <div className="flex items-center gap-3">
                <select className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-300" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as CaseStatus | 'all')}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-300" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-300" value={analystFilter} onChange={(e) => setAnalystFilter(e.target.value)}>
                  {analysts.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {cases.loading ? (
              <div className="flex justify-center py-12"><Spinner /></div>
            ) : caseItems.length === 0 ? (
              <div className="py-20"><EmptyState message="No investigations in current view." /></div>
            ) : (
              <div className="divide-y divide-zinc-800/50">
                {caseItems.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setExpandedCaseId(c.id); void refreshEvents(); void refreshComments() }}
                    className={`w-full text-left grid grid-cols-[1.2fr_1fr_auto_auto_auto] items-center gap-3 px-4 py-3 ${expandedCaseId === c.id ? 'bg-violet-900/10' : 'hover:bg-zinc-800/30'}`}
                  >
                    <div>
                      <p className="text-sm font-bold text-zinc-100">{c.id}</p>
                      <p className="font-mono text-[10px] text-zinc-500 truncate">tx: {c.transaction_id}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-zinc-500">Analyst</p>
                      <p className="text-xs text-zinc-300">{c.owner}</p>
                    </div>
                    <div className="text-right"><Badge value={c.severity} size="md" /></div>
                    <div className="text-right"><Badge value={c.status} size="md" /></div>
                    <div className="text-right">
                      <p className="text-[10px] text-zinc-500">SLA</p>
                      <span className={`text-xs font-bold ${(c.queue_priority_score ?? 0) > 250 ? 'text-red-400' : 'text-amber-400'}`}>{Math.max(5, 120 - Math.floor((c.queue_priority_score ?? 0) / 2))}m</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <ErrorBanner message={cases.error} />
        </Panel>

        <div className="lg:col-span-5 flex flex-col gap-6">
          <Panel glow="cyan">
            <h3 className="mb-3 text-sm font-semibold text-zinc-200">Case Workbench</h3>
            {!selectedCase ? (
              <EmptyState message="Select a case to view details, notes, and evidence timeline." />
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                  <p className="text-xs text-zinc-500">Case</p>
                  <p className="text-sm font-semibold text-zinc-100">{selectedCase.id}</p>
                  <p className="text-[11px] text-zinc-500 mt-1">Transaction: {selectedCase.transaction_id}</p>
                  <p className="text-[11px] text-zinc-500">Queue priority: {selectedCase.queue_priority_score ?? 0}</p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button type="button" onClick={() => void runAction(selectedCase.id, 'freeze')} className="rounded border border-red-500/40 bg-red-500/10 py-1.5 text-xs text-red-300">Freeze</button>
                  <button type="button" onClick={() => void runAction(selectedCase.id, 'escalate')} className="rounded border border-amber-500/40 bg-amber-500/10 py-1.5 text-xs text-amber-300">Escalate</button>
                  <button type="button" onClick={() => void runAction(selectedCase.id, 'close')} className="rounded border border-emerald-500/40 bg-emerald-500/10 py-1.5 text-xs text-emerald-300">Close</button>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                  <p className="text-xs text-zinc-500 mb-2">SHAP explanation preview</p>
                  <div className="space-y-1 text-[11px] text-zinc-300">
                    <p>amount_to_org_balance_ratio: +0.42</p>
                    <p>queue_risk_score: +0.35</p>
                    <p>mule_cluster_density: +0.31</p>
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                  <p className="text-xs text-zinc-500 mb-2">Case notes</p>
                  <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                    {(comments.data?.items ?? []).map((cm) => (
                      <div key={cm.id} className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1">
                        <p className="text-[10px] text-zinc-500">{cm.author} • {new Date(cm.created_at).toLocaleString()}</p>
                        <p className="text-xs text-zinc-300">{cm.message}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200" placeholder="Add case note…" />
                    <button type="button" disabled={commentBusy} onClick={() => void addComment()} className="rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-300 disabled:opacity-40">Add</button>
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                  <p className="text-xs text-zinc-500 mb-2">Attachment upload</p>
                  <div className="flex gap-2">
                    <input value={attachmentDraft.filename} onChange={(e) => setAttachmentDraft((p) => ({ ...p, filename: e.target.value }))} className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200" placeholder="evidence.txt" />
                    <button type="button" onClick={() => void uploadAttachment()} className="rounded border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-xs text-violet-300">Upload</button>
                  </div>
                </div>
              </div>
            )}
          </Panel>

          <Panel className="p-0 overflow-hidden flex flex-col border border-zinc-800">
            <div className="bg-zinc-900/80 border-b border-zinc-800/80 p-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-100">Immutable Audit Timeline</h3>
              {audits.loading && <Spinner size="sm" />}
            </div>
            <div className="flex-1 overflow-y-auto bg-zinc-950 p-2 space-y-1 max-h-[270px]">
              {(audits.data?.items ?? []).length === 0 && !audits.loading ? (
                <EmptyState message="No audit records yet" />
              ) : (
                (audits.data?.items ?? []).map((a) => (
                  <div key={a.id} className="rounded border border-zinc-800/40 bg-zinc-900/40 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase font-bold text-zinc-400">{a.actor}</span>
                      <span className="text-[10px] font-mono text-zinc-500">{new Date(a.timestamp).toLocaleString()}</span>
                    </div>
                    <p className="text-[11px] text-zinc-300">Action: <span className="text-zinc-100">{a.action}</span></p>
                    <p className="text-[10px] text-zinc-500">Target: {a.target}</p>
                    <p className="text-[10px] text-zinc-600">Model: {a.model_version ?? 'xgb.joblib'} • Rule: {a.rule_version ?? 'rules_config_v2'}</p>
                  </div>
                ))
              )}
            </div>
            <ErrorBanner message={audits.error} />
          </Panel>

          <Panel>
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">Evidence timeline</h3>
            {expandedCaseId ? (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {(events.data?.items ?? []).map((ev) => (
                  <div key={ev.id} className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
                    <p className="text-[10px] text-zinc-500">{new Date(ev.created_at).toLocaleString()} • {ev.actor}</p>
                    <p className="text-xs text-zinc-300">{ev.action}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="Select a case to load event history." />
            )}
          </Panel>
        </div>
      </div>
      <ToastContainer />
    </div>
  )
}
