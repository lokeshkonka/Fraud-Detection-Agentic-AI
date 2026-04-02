// ---------------------------------------------------------------------------
// DocsPage — comprehensive platform documentation for banks and fintech teams.
// ---------------------------------------------------------------------------

import { SectionHeader } from '../components/ui/SectionHeader'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'

interface DocsPageProps {
  apiBase: string
}

const HTTP_METHOD_STYLE: Record<string, string> = {
  GET: 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30',
  POST: 'bg-violet-500/15 text-violet-300 border border-violet-500/30',
  PATCH: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
}

const API_CATALOG = [
  { method: 'GET',   path: '/health',                          purpose: 'Gateway and all downstream service health status.' },
  { method: 'POST',  path: '/score',                           purpose: 'Real-time fraud scoring for a single transaction. Returns score, label, decision, reasons, rule/model decomposition.' },
  { method: 'POST',  path: '/batch-score',                     purpose: 'Bulk fraud scoring — up to 200 transactions per call. Returns per-item results plus aggregated summary stats.' },
  { method: 'POST',  path: '/explain',                         purpose: 'SHAP-like feature contribution explainability. Returns per-feature contribution weights for a scored transaction.' },
  { method: 'GET',   path: '/dashboard/overview',              purpose: '24-hour KPI snapshot: transaction volume, fraud rate, avg score, open cases, decision distribution, graph and model-ops summary.' },
  { method: 'GET',   path: '/transaction-flow/recent',         purpose: 'Paginated list of persisted transaction decisions (limit, page params).' },
  { method: 'POST',  path: '/simulation/run',                  purpose: 'Generate realistic synthetic fraud scenarios. Params: count, fraud_ratio, max_amount, start_seconds_ago.' },
  { method: 'GET',   path: '/simulation/last-run',             purpose: 'Retrieve the most recent simulation run with all events and summary.' },
  { method: 'GET',   path: '/simulation/archetypes/detail',    purpose: 'Full catalogue of fraud archetypes with descriptions and risk levels.' },
  { method: 'GET',   path: '/graph-intelligence/network',      purpose: 'Graph nodes, edges, and ring cluster data for visualization.' },
  { method: 'GET',   path: '/graph-intelligence/overview',     purpose: 'Summary KPIs: total nodes, edges, high-risk nodes, mule-ring signals.' },
  { method: 'GET',   path: '/model-lab/overview',              purpose: 'Champion model metrics (PR-AUC, ROC-AUC), feature stats, accuracy curve, drift baseline.' },
  { method: 'GET',   path: '/model-ops/overview',              purpose: 'Champion/challenger details, retrain schedule countdown, drift metrics, adaptive learning, history, and artifacts.' },
  { method: 'POST',  path: '/model-ops/retrain-now',           purpose: 'Trigger an immediate challenger retrain cycle outside of the 7-day schedule.' },
  { method: 'POST',  path: '/model-ops/promote',               purpose: 'Promote the current challenger to champion. Audited and reflected in dashboard.' },
  { method: 'POST',  path: '/model-ops/rollback',              purpose: 'Roll back to the baseline champion version (xgb_trained_external_v1).' },
  { method: 'GET',   path: '/cases-audit/list',                purpose: 'Paginated fraud case list. Filter by status: open, investigating, escalated, closed.' },
  { method: 'GET',   path: '/cases-audit/audits',              purpose: 'Immutable audit log — all actor/action/target events from inference, ops, and case management.' },
  { method: 'GET',   path: '/rule-studio/rules',               purpose: 'Retrieve active rule configuration: risk_threshold, velocity_limit, high_risk_channels.' },
  { method: 'POST',  path: '/rule-studio/rules/evaluate',      purpose: 'Simulate and persist a rule configuration update. All changes are audited.' },
]

const DECISION_BANDS = [
  { decision: 'approve',      scoreRange: '< threshold',       severity: 'none',     action: 'Transaction passes through normally.' },
  { decision: 'step_up_auth', scoreRange: 'fraud + score < 65%', severity: 'low',   action: 'Require OTP or additional authentication before clearing.' },
  { decision: 'hold',         scoreRange: 'fraud + score 65–85%', severity: 'high', action: 'Suspend transaction. Auto-open high-severity case.' },
  { decision: 'freeze',       scoreRange: 'fraud + score ≥ 85%', severity: 'critical', action: 'Block transaction and freeze account. Auto-open critical case.' },
]

export function DocsPage({ apiBase }: DocsPageProps) {
  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Platform Documentation"
        subtitle="Bank-grade fraud intelligence architecture, model layers, and API gateway integration guidance"
      />

      {/* Audience */}
      <Panel glow="cyan">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-200">Who this is for</h3>
          <Badge value="enterprise" label="Banks & Fintechs" />
        </div>
        <p className="text-sm leading-relaxed text-zinc-400">
          This platform is purpose-built for fraud operations, risk engineering, and model governance teams that require
          production-grade real-time scoring, SHAP explainability, graph network intelligence, and fully auditable
          case workflows from a single enterprise control plane.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            { role: 'Fraud Analysts', desc: 'Cases & Audit, Transaction Flow, Graph Intelligence' },
            { role: 'Risk Engineers', desc: 'Rule Studio, Model Lab, Simulation Lab' },
            { role: 'ML/Model Ops', desc: 'Model Lab, Model Ops, retrain lifecycle' },
          ].map(({ role, desc }) => (
            <div key={role} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <p className="mb-1 text-xs font-semibold text-zinc-200">{role}</p>
              <p className="text-xs text-zinc-500">{desc}</p>
            </div>
          ))}
        </div>
      </Panel>

      {/* Architecture layers */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel glow="violet">
          <h3 className="mb-4 text-sm font-semibold text-zinc-200">ML Architecture — 7 Layers</h3>
          <ol className="space-y-3 text-sm">
            {[
              { layer: 'Layer 0', label: 'Ingestion', color: 'text-zinc-400', detail: 'Transaction intake via API gateway. Kafka + Redis reserved for streaming at scale.' },
              { layer: 'Layer 1', label: 'Rules Engine', color: 'text-cyan-400', detail: 'Bayesian policy rules: velocity, channel risk, night window, merchant flag. Contributes 35% of final score.' },
              { layer: 'Layer 2', label: 'ML Inference', color: 'text-violet-400', detail: 'Composite probabilistic model: XGB champion + LR/RF baselines. Contributes 65% of final score.' },
              { layer: 'Layer 3', label: 'Decision Engine', color: 'text-amber-400', detail: 'Maps final_prob to: approve / step_up_auth / hold / freeze. Auto-creates cases for hold/freeze.' },
              { layer: 'Layer 4', label: 'Drift & Governance', color: 'text-emerald-400', detail: 'PSI, mean-shift, variance-shift tracking against drift_baseline.json. Triggers retraining.' },
              { layer: 'Layer 4.7', label: '7-Day Retrain Scheduler', color: 'text-rose-400', detail: 'Scheduled challenger training. Promote/rollback via Model Ops UI or API.' },
              { layer: 'Layer 5', label: 'Simulation & Graph', color: 'text-sky-400', detail: 'Synthetic archetype injection + entity graph intelligence (mule rings, high-risk nodes).' },
            ].map(({ layer, label, color, detail }) => (
              <li key={layer} className="flex gap-3">
                <div className="mt-0.5 shrink-0 text-right">
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">{layer}</span>
                </div>
                <div>
                  <span className={`text-sm font-semibold ${color}`}>{label}</span>
                  <p className="mt-0.5 text-xs text-zinc-500">{detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <div className="flex flex-col gap-4">
          {/* Scoring formula */}
          <Panel glow="emerald">
            <h3 className="mb-3 text-sm font-semibold text-zinc-200">Scoring Formula</h3>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-300">
              <p className="text-zinc-500"># Final composite score</p>
              <p>final_prob = <span className="text-cyan-300">0.35</span> × rule_score + <span className="text-violet-300">0.65</span> × model_score</p>
              <p className="mt-2 text-zinc-500"># Rule score components</p>
              <p>rule_score = (</p>
              <p className="pl-4">w_amount × min(amount_norm, 1.0)</p>
              <p className="pl-4">+ w_velocity × min(velocity / velocity_limit, 1.0)</p>
              <p className="pl-4">+ w_channel × is_high_risk_channel</p>
              <p className="pl-4">+ w_merchant × merchant_missing</p>
              <p className="pl-4">+ w_night × night_risk</p>
              <p>) / 4.2</p>
              <p className="mt-2 text-zinc-500"># Model score (logistic)</p>
              <p>model_score = σ(Σ w_i × feature_i − 1.4)</p>
            </div>
          </Panel>

          {/* Decision bands */}
          <Panel glow="red">
            <h3 className="mb-3 text-sm font-semibold text-zinc-200">Decision Bands</h3>
            <div className="space-y-2">
              {DECISION_BANDS.map(({ decision, scoreRange, action }) => (
                <div key={decision} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                  <div className="flex items-center gap-2">
                    <Badge value={decision} />
                    <span className="text-[10px] text-zinc-500 font-mono">{scoreRange}</span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{action}</p>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* Transaction flow */}
      <Panel>
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">Transaction Flow — End to End</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {[
            'Client → POST /score',
            'API Gateway validates + proxies',
            'ML Inference: rules + model → score',
            'Decision band mapping',
            'Audit log created',
            'Case opened (hold/freeze)',
            'Graph sync (events)',
            'Dashboard KPIs updated',
          ].map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5 text-zinc-300">{step}</div>
              {i < 7 && <span className="text-zinc-700">→</span>}
            </div>
          ))}
        </div>
      </Panel>

      {/* API integration */}
      <Panel>
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">API Gateway — Integration Guide</h3>
        <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="mb-1 text-zinc-200">Base URL</p>
            <p className="font-mono text-xs text-cyan-300 break-all">{apiBase}</p>
            <p className="mt-1 text-[10px] text-zinc-600">Docker: http://api-gateway:8000 (nginx: /api/)</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="mb-1 text-zinc-200">Authentication</p>
            <p className="text-xs text-zinc-500">No auth required in this deployment. In production, add an Authorization header (Bearer JWT) via nginx or an API gateway layer.</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="mb-1 text-zinc-200">Transaction ID</p>
            <p className="text-xs text-zinc-500">Must be globally unique and immutable. UUIDs or your payment system's reference ID are both acceptable. Duplicate IDs use UPSERT (idempotent).</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="mb-1 text-zinc-200">Timestamps</p>
            <p className="text-xs text-zinc-500">Send ISO 8601 UTC strings (e.g. 2024-01-15T14:22:00Z). Used for night-window risk feature and audit traceability.</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="mb-1 text-zinc-200">Channels</p>
            <p className="text-xs text-zinc-500">Accepted: <span className="font-mono text-zinc-300">card | wire | crypto | ach | upi</span>. Wire, crypto, and UPI are high-risk by default (configurable via Rule Studio).</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="mb-1 text-zinc-200">Sync vs Async</p>
            <p className="text-xs text-zinc-500">Use <span className="font-mono text-zinc-300">/score</span> synchronously in your payment authorization path. Use <span className="font-mono text-zinc-300">/batch-score</span> for post-event monitoring pipelines.</p>
          </div>
        </div>
      </Panel>

      {/* Score request/response example */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h3 className="mb-3 text-sm font-semibold text-zinc-200">Sample — POST /score Request</h3>
          <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-300">{`{
  "transaction_id": "txn_abc123_xyz",
  "user_id": "user_9f3a2b",
  "amount": 4200.00,
  "merchant": "electronics",
  "channel": "wire",
  "timestamp": "2024-01-15T23:45:00Z",
  "features": {
    "velocity": 7,
    "balance_delta_org": 4200,
    "balance_delta_dest": -4200
  }
}`}</pre>
        </Panel>
        <Panel>
          <h3 className="mb-3 text-sm font-semibold text-zinc-200">Sample — POST /score Response</h3>
          <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-300">{`{
  "transaction_id": "txn_abc123_xyz",
  "user_id": "user_9f3a2b",
  "amount": 4200.00,
  "channel": "wire",
  "score": 0.8712,
  "label": "fraud",
  "decision": "freeze",
  "reasons": [
    "high_risk_channel",
    "high_velocity",
    "night_window",
    "extreme_risk_probability"
  ],
  "rule_score": 0.7834,
  "model_score": 0.9011,
  "timestamp": "2024-01-15T23:45:00.000Z"
}`}</pre>
        </Panel>
      </div>

      {/* Docker deploy */}
      <Panel glow="emerald">
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">Docker Deployment</h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs text-zinc-500">Start all services</p>
            <pre className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-zinc-300">{`# Full stack (first run)
docker compose up --build -d

# Check service health
docker compose ps

# View gateway logs
docker compose logs -f api-gateway

# Smoke test
curl http://localhost:8000/health`}</pre>
          </div>
          <div>
            <p className="mb-2 text-xs text-zinc-500">Service ports</p>
            <div className="space-y-1.5 text-xs">
              {[
                ['Web Dashboard', 'localhost:3000'],
                ['API Gateway', 'localhost:8000'],
                ['ML Inference', 'localhost:8500'],
                ['Simulation Engine', 'localhost:8600'],
                ['Retrain Scheduler', 'localhost:8700'],
                ['Audit Service', 'localhost:8800'],
                ['Graph Service', 'localhost:8900'],
                ['Nginx (unified)', 'localhost:80'],
                ['PostgreSQL', 'localhost:5432'],
                ['MinIO (artifacts)', 'localhost:9001'],
              ].map(([svc, addr]) => (
                <div key={svc} className="flex justify-between rounded border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
                  <span className="text-zinc-400">{svc}</span>
                  <span className="font-mono text-cyan-300">{addr}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      {/* Full endpoint catalog */}
      <Panel glow="amber">
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">Complete Endpoint Catalog</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="px-2 py-2 font-medium">Method</th>
                <th className="px-2 py-2 font-medium">Path</th>
                <th className="px-2 py-2 font-medium">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {API_CATALOG.map((item) => (
                <tr key={`${item.method}:${item.path}`} className="border-b border-zinc-900 hover:bg-zinc-900/40">
                  <td className="px-2 py-2">
                    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${HTTP_METHOD_STYLE[item.method] ?? 'bg-zinc-700/60 text-zinc-300 border border-zinc-600'}`}>
                      {item.method}
                    </span>
                  </td>
                  <td className="px-2 py-2 font-mono text-xs text-cyan-300">{item.path}</td>
                  <td className="px-2 py-2 text-xs text-zinc-400">{item.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Compliance */}
      <Panel>
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">Compliance & Governance</h3>
        <div className="grid gap-3 sm:grid-cols-2 text-sm text-zinc-400">
          {[
            { title: 'Full Audit Trail', desc: 'Every scoring decision, case action, rule change, and model promotion is recorded in an immutable audit log.' },
            { title: 'Explainability', desc: 'SHAP-like contributions are available for every scored transaction via POST /explain, satisfying regulatory explainability requirements.' },
            { title: 'Champion/Challenger', desc: 'Model lifecycle is governed — changes require explicit promotion via API or UI, with automatic audit logging.' },
            { title: 'Drift Monitoring', desc: 'PSI, mean-shift, and variance-shift are tracked continuously. Auto-retrain triggers on drift breach or on 7-day schedule.' },
          ].map(({ title, desc }) => (
            <div key={title} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <p className="mb-1 text-xs font-semibold text-zinc-200">{title}</p>
              <p className="text-xs">{desc}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

