import { useMemo, useState } from 'react'
import { SectionHeader } from '../components/ui/SectionHeader'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'

interface DocsPageProps {
  apiBase: string
}

const MERMAID = {
  traditional: `flowchart LR
    A[Txn intake] --> B[Static rules]
    B --> C{Threshold hit?}
    C -- No --> D[Approve]
    C -- Yes --> E[Manual review]
    E --> F[Late fraud detection]`,
  ai: `flowchart LR
    A[Ingestion] --> B[Schema Validation]
    B --> C[Feature Engineering]
    C --> D[Rule Pre-check]
    D --> E[XGBoost Inference]
    E --> F[Risk Fusion]
    F --> G[Threshold Routing]
    G --> H[Queue Optimization]
    H --> I[Case Generation]
    I --> J[Audit + Feedback Retraining]`,
  lifecycle: `flowchart LR
    A[Case Opened] --> B[Analyst Triage]
    B --> C{Action}
    C --> D[Freeze]
    C --> E[Escalate]
    C --> F[Close]
    D --> G[Audit Log]
    E --> G
    F --> G`,
  mule: `flowchart LR
    A[Graph ingest] --> B[Ring detection]
    B --> C[Risk propagation]
    C --> D[Path replay]
    D --> E[Freeze recommendation]
    E --> F[Case + audit]`,
  feedback: `flowchart LR
    A[Analyst decisions] --> B[Label curation]
    B --> C[Drift check]
    C --> D[Challenger retrain]
    D --> E[Champion comparison]
    E --> F[Promote/Rollback]
    F --> A`,
}

const COMPARISON = [
  ['static thresholds', 'Mostly static', 'Dynamic rule + ML fusion', 'Wrong'],
  ['real-time ML scoring', 'Limited / offline', 'Real-time XGBoost scoring', 'Right'],
  ['mule ring detection', 'Manual correlation', 'Graph ring intelligence', 'Right'],
  ['fraud path replay', 'Unavailable', 'Replay path animation timeline', 'Right'],
  ['analyst queue optimization', 'FIFO queue', 'Risk-priority queue', 'Right'],
  ['drift monitoring', 'Ad-hoc checks', 'PSI + mean/variance drift baseline', 'Right'],
  ['explainability', 'Sparse reasons', 'SHAP-like feature contributions', 'Right'],
  ['case auto-generation', 'Manual case opening', 'Auto create on hold/freeze', 'Right'],
  ['graph intelligence', 'Static relationship view', 'Live graph + cluster actions', 'Right'],
  ['adaptive rule learning', 'Rare manual tuning', 'Rule simulation + workflow controls', 'Partial'],
] as const

function verdictClass(v: string) {
  if (v === 'Right') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
  if (v === 'Partial') return 'border-amber-500/40 bg-amber-500/10 text-amber-300'
  return 'border-red-500/40 bg-red-500/10 text-red-300'
}

export function DocsPage({ apiBase }: DocsPageProps) {
  const [open, setOpen] = useState<string | null>('Problem')
  const sections = useMemo(
    () => [
      ['Problem', 'Banks lose billions to coordinated mule rings, account takeovers, and smurfing patterns that evade static controls.'],
      ['Why traditional systems fail', 'Static thresholds break under evolving behavior, delayed reviews, and weak entity linkage context.'],
      ['Our fraud types solved', 'Mule laddering, account takeover, cross-border smurfing, velocity burst abuse, and merchant collusion patterns.'],
      ['Real-time architecture', `API base: ${apiBase}. Real-time ingestion, ML scoring, graph sync, and case/audit orchestration.`],
      ['ML behavior model', 'Updated XGBoost behavior model with refreshed feature engineering, PR/ROC capture curves, and queue precision gains.'],
      ['queue intelligence', 'Queue priority score combines severity, drift pressure, and behavioral confidence for analyst throughput.'],
      ['case lifecycle', 'Auto-create on hold/freeze, SLA-aware triage, notes/evidence timeline, and controlled status transitions.'],
      ['governance and audit', 'Append-only audit history with actor/action/target timestamps and exportable compliance traces.'],
      ['measurable business ROI', 'Higher fraud catch, lower false positives, faster analyst triage, and reduced operational loss leakage.'],
      ['future scalability', 'Streaming ingestion, websocket queue updates, and federated policy rollout for multi-region banking deployments.'],
    ],
    [apiBase],
  )

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Enterprise Fraud Intelligence Documentation" subtitle="Dark-theme demo storytelling with Mermaid flows, architecture comparisons, and governance narratives" />

      <Panel glow="cyan">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-200">Audience</h3>
          <Badge value="enterprise" label="Banks & Fintechs" />
        </div>
        <p className="text-sm leading-relaxed text-zinc-400">
          Production-grade fraud operations, risk engineering, and model governance platform with updated ML artifacts as the only source of truth.
        </p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel glow="violet"><h3 className="mb-2 text-sm font-semibold text-zinc-200">A) Traditional fraud flow</h3><pre className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-zinc-300 overflow-x-auto">{`mermaid\n${MERMAID.traditional}`}</pre></Panel>
        <Panel glow="emerald"><h3 className="mb-2 text-sm font-semibold text-zinc-200">B) Our AI fraud intelligence flow</h3><pre className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-zinc-300 overflow-x-auto">{`mermaid\n${MERMAID.ai}`}</pre></Panel>
        <Panel glow="amber"><h3 className="mb-2 text-sm font-semibold text-zinc-200">C) Fraud case lifecycle</h3><pre className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-zinc-300 overflow-x-auto">{`mermaid\n${MERMAID.lifecycle}`}</pre></Panel>
        <Panel glow="red"><h3 className="mb-2 text-sm font-semibold text-zinc-200">D) Mule ring detection pipeline</h3><pre className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-zinc-300 overflow-x-auto">{`mermaid\n${MERMAID.mule}`}</pre></Panel>
        <Panel glow="cyan" className="lg:col-span-2"><h3 className="mb-2 text-sm font-semibold text-zinc-200">E) Analyst feedback retraining loop</h3><pre className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-zinc-300 overflow-x-auto">{`mermaid\n${MERMAID.feedback}`}</pre></Panel>
      </div>

      <Panel glow="amber">
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">Traditional vs Our AI System</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="px-2 py-2 font-medium">Feature</th>
                <th className="px-2 py-2 font-medium">Traditional</th>
                <th className="px-2 py-2 font-medium">Our AI System</th>
                <th className="px-2 py-2 font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map(([feature, trad, ours, verdict]) => (
                <tr key={feature} className="border-b border-zinc-900">
                  <td className="px-2 py-2 text-zinc-300">{feature}</td>
                  <td className="px-2 py-2 text-zinc-500">{trad}</td>
                  <td className="px-2 py-2 text-cyan-200">{ours}</td>
                  <td className="px-2 py-2">
                    <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${verdictClass(verdict)}`}>{verdict}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">Enterprise demo storytelling</h3>
        <div className="space-y-2">
          {sections.map(([title, content]) => {
            const isOpen = open === title
            return (
              <div key={title} className="rounded-lg border border-zinc-800 bg-zinc-950/60">
                <button type="button" onClick={() => setOpen(isOpen ? null : title)} className="w-full flex items-center justify-between px-3 py-2 text-left">
                  <span className="text-sm font-medium text-zinc-200">{title}</span>
                  <span className="text-zinc-500">{isOpen ? '−' : '+'}</span>
                </button>
                {isOpen && (
                  <div className="border-t border-zinc-800 px-3 py-3 animate-[fadeIn_.2s_ease_both]">
                    <pre className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">{content}</pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}
