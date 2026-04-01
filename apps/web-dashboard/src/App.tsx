import React from "react";

const pages = [
  "dashboard",
  "transaction-flow",
  "simulation-lab",
  "graph-intelligence",
  "model-lab",
  "model-ops",
  "cases-audit",
  "rule-studio",
];

const kpis = [
  { label: "Next retrain", value: "in 6h", tone: "text-acid" },
  { label: "Last AUC-PR", value: "0.931", tone: "text-green-400" },
  { label: "Challenger delta", value: "+1.4%", tone: "text-lava" },
  { label: "PSI", value: "0.07", tone: "text-green-300" },
];

const retrainEvents = [
  { label: "Shadow run", status: "Complete", detail: "Challenger vs champion" },
  { label: "Drift check", status: "PSI 0.07", detail: "Features stable" },
  { label: "Analyst review", status: "Pending", detail: "Approval needed" },
];

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-lg shadow-black/30">
      <div className="text-sm uppercase tracking-[0.2em] text-slate-400">{title}</div>
      {children}
    </div>
  );
}

export default function App() {
  return (
    <div className="min-h-screen px-6 py-8 md:px-12 lg:px-16">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Fraud Agentic Platform</p>
          <h1 className="text-3xl font-semibold text-white md:text-4xl">Model Ops Control</h1>
          <p className="text-slate-400">Scheduled retrains, drift, challenger vs champion, promote/rollback.</p>
        </div>
        <button className="rounded-full bg-acid px-4 py-2 text-sm font-semibold text-ink-900 shadow-md shadow-acid/30 transition hover:-translate-y-0.5 hover:shadow-lg">
          Promote challenger
        </button>
      </header>

      <section className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} title={kpi.label}>
            <div className={`mt-2 text-2xl font-semibold ${kpi.tone}`}>{kpi.value}</div>
          </Card>
        ))}
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card title="Challenger vs Champion">
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-slate-300">
              <div>
                <div className="text-slate-400">Champion</div>
                <div className="text-lg text-white">xgb_fraud_v1</div>
                <div className="text-emerald-300">AUC-PR 0.931</div>
              </div>
              <div>
                <div className="text-slate-400">Challenger</div>
                <div className="text-lg text-white">xgb_fraud_v2</div>
                <div className="text-amber-300">AUC-PR 0.945</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-400">
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">False positive rate ↘︎ 0.3%</div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">Lift at top 1% ↗︎ 2.1x</div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">GNN recall ↗︎ 0.8</div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">Latency stable</div>
            </div>
          </Card>
          <Card title="Drift">
            <div className="mt-3 flex items-center justify-between text-slate-200">
              <div>
                <div className="text-2xl font-semibold text-acid">PSI 0.07</div>
                <div className="text-xs text-slate-400">Feature drift below threshold</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-300">
                Rolling 7d window
              </div>
            </div>
          </Card>
        </div>
        <Card title="Retrain Timeline">
          <div className="mt-4 space-y-3 text-sm text-slate-200">
            {retrainEvents.map((event) => (
              <div key={event.label} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-white">{event.label}</div>
                  <span className="rounded-full bg-ink-900 px-3 py-1 text-xs text-slate-300">{event.status}</span>
                </div>
                <div className="text-xs text-slate-400">{event.detail}</div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="mt-8">
        <Card title="Routes">
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-200 md:grid-cols-4">
            {pages.map((page) => (
              <div key={page} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 capitalize">
                /{page}
              </div>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}
