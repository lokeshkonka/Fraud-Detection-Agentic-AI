import { SectionHeader } from '../components/ui/SectionHeader'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'

interface DocsPageProps {
  apiBase: string
}

const API_CATALOG = [
  { method: 'GET', path: '/health', purpose: 'Gateway and downstream service health status.' },
  { method: 'POST', path: '/score', purpose: 'Real-time fraud scoring for a single transaction.' },
  { method: 'POST', path: '/batch-score', purpose: 'Bulk fraud scoring for batched transaction payloads.' },
  { method: 'POST', path: '/explain', purpose: 'SHAP-like feature contribution explainability output.' },
  { method: 'GET', path: '/dashboard/overview', purpose: 'Operational KPI summary for command center.' },
  { method: 'GET', path: '/transaction-flow/recent', purpose: 'Recent transaction decisions with pagination.' },
  { method: 'POST', path: '/simulation/run', purpose: 'Generate realistic synthetic fraud scenarios.' },
  { method: 'GET', path: '/graph-intelligence/network', purpose: 'Graph nodes/edges/rings for network risk analysis.' },
  { method: 'GET', path: '/model-lab/overview', purpose: 'Model metrics, drift baseline, feature stats, and curves.' },
  { method: 'GET', path: '/model-ops/overview', purpose: 'Champion/challenger, retrain cadence, and artifacts.' },
]

export function DocsPage({ apiBase }: DocsPageProps) {
  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Platform Documentation"
        subtitle="Bank-grade fraud intelligence architecture, model layers, and API gateway integration guidance"
      />

      <Panel glow="cyan">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-200">Who this is for</h3>
          <Badge value="enterprise" label="Banks & Fintechs" />
        </div>
        <p className="text-sm leading-relaxed text-zinc-400">
          This platform is built for fraud operations, risk engineering, and model governance teams that need
          production-grade scoring, explainability, graph intelligence, and auditable case workflows from a unified
          control plane.
        </p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel glow="violet">
          <h3 className="mb-3 text-sm font-semibold text-zinc-200">ML model layers</h3>
          <ul className="space-y-2 text-sm text-zinc-400">
            <li><span className="text-zinc-200">1. Feature Layer:</span> Amount, velocity, channel risk, merchant, and balance-delta features are engineered at scoring time.</li>
            <li><span className="text-zinc-200">2. Rule Layer:</span> Policy-weighted risk signals calibrate guardrail behavior for compliance and instant controls.</li>
            <li><span className="text-zinc-200">3. Model Layer:</span> Probabilistic fraud inference creates transaction-level risk scores.</li>
            <li><span className="text-zinc-200">4. Decision Layer:</span> Actions are mapped to approve, step_up_auth, hold, or freeze.</li>
            <li><span className="text-zinc-200">5. Governance Layer:</span> Drift baseline, challenger tracking, retrain history, and artifact lineage are continuously monitored.</li>
          </ul>
        </Panel>

        <Panel glow="emerald">
          <h3 className="mb-3 text-sm font-semibold text-zinc-200">Fraud intelligence flow</h3>
          <ol className="space-y-2 text-sm text-zinc-400">
            <li>1) Transaction enters API Gateway for orchestration and validation.</li>
            <li>2) ML Inference returns score, label, reason codes, and model-rule decomposition.</li>
            <li>3) Decision policy triggers controls and audit log creation.</li>
            <li>4) High-risk decisions auto-open fraud cases for investigation.</li>
            <li>5) Events are synced into graph service for ring and network intelligence.</li>
            <li>6) Retrain scheduler tracks drift and supports champion/challenger operations.</li>
          </ol>
        </Panel>
      </div>

      <Panel>
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">API gateway usage for enterprise integration</h3>
        <div className="grid gap-3 text-sm text-zinc-400 md:grid-cols-2">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="mb-1 text-zinc-200">Base URL</p>
            <p className="font-mono text-xs text-cyan-300">{apiBase}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="mb-1 text-zinc-200">Payload expectations</p>
            <p>Use immutable transaction IDs, UTC timestamps, and normalized channel values for deterministic scoring.</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="mb-1 text-zinc-200">Operational model</p>
            <p>Integrate synchronous scoring in payment authorization flow and async batch scoring for post-event monitoring.</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="mb-1 text-zinc-200">Control & compliance</p>
            <p>Use audit and case endpoints to enforce explainability, triage workflows, and regulator-facing traceability.</p>
          </div>
        </div>
      </Panel>

      <Panel glow="amber">
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">Core endpoint catalog</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="px-2 py-2 font-medium">Method</th>
                <th className="px-2 py-2 font-medium">Path</th>
                <th className="px-2 py-2 font-medium">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {API_CATALOG.map((item) => (
                <tr key={`${item.method}:${item.path}`} className="border-b border-zinc-900 text-zinc-300">
                  <td className="px-2 py-2"><Badge value={item.method.toLowerCase()} label={item.method} /></td>
                  <td className="px-2 py-2 font-mono text-xs text-cyan-300">{item.path}</td>
                  <td className="px-2 py-2 text-zinc-400">{item.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
