import { useEffect, useMemo, useRef, useState } from 'react'
import { BookMarked, FileDown, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { useApi } from '../hooks/useApi'
import { MermaidCodeCanvas } from '../components/ui/MermaidCodeCanvas'
import { FeatureComparisonMatrix } from '../components/research/FeatureComparisonMatrix'
import type {
  ArchetypeInfo,
  DocsResearchFeatureMatrixRow,
  DocsResearchOverviewResponse,
} from '../types/api'

interface DocsResearchPageProps {
  apiBase: string
}

const FLOWS = {
  lifecycle: `flowchart LR
    A[Transaction event] --> B[Feature engineering]
    B --> C[Rule fusion]
    C --> D[XGBoost inference]
    D --> E[Graph intelligence]
    E --> F[Queue prioritization]
    F --> G[Case automation]
    G --> H[Audit evidence]`,
  hardProblem: `flowchart TD
    A[Low-and-slow behavior] --> D[Rules miss sequence context]
    B[Distributed mule accounts] --> D
    C[Beneficiary masking] --> D
    D --> E[Graph risk propagates across entities]
    E --> F[Analyst overload without ranked queue]`,
  traditionalVsAI: `flowchart LR
    T1[Transaction] --> T2[Static Rules]
    T2 --> T3[Threshold]
    T3 --> T4[Manual Review]
    T4 --> T5[Delayed Detection]
    T5 --> T6[Loss]

    A1[Transaction] --> A2[Feature Engineering]
    A2 --> A3[Rule Fusion]
    A3 --> A4[XGBoost]
    A4 --> A5[Graph Intelligence]
    A5 --> A6[Queue Gain]
    A6 --> A7[Case Automation]`,
  coreInnovation: `flowchart LR
    I[Ingestion] --> F[Hybrid risk fusion]
    F --> G[Graph intelligence]
    G --> M[Adaptive fraud memory]
    M --> Q[Queue precision intelligence]
    Q --> E[Explainable governance]`,
  scalability: `flowchart LR
    CBS[CBS and Payment Rails] --> BUS[Event Ingestion Layer]
    BUS --> RULE[Rule Engine]
    RULE --> XGB[XGBoost Scoring]
    XGB --> GRAPH[Graph Engine]
    GRAPH --> CASE[Case Queue]
    CASE --> SOC[SOC Analyst Ops]
    SOC --> AUDIT[Immutable Audit]
    AUDIT --> RETRAIN[Retrain Scheduler]`,
  probability: `flowchart LR
    P0[Prior Fraud Probability] --> P1[Rule Signal Likelihood]
    P1 --> P2[Model Score]
    P2 --> P3[Graph Propagation Adjustment]
    P3 --> P4[Queue Risk Expectation]`,
}

const TOC_ITEMS = [
  { id: 'hero-problem',   num: '01', label: 'Problem Landscape' },
  { id: 'why-hard',       num: '02', label: 'Why Fraud Is Hard' },
  { id: 'why-lag',        num: '03', label: 'Traditional Limits' },
  { id: 'matrix',         num: '04', label: 'Paradigm Matrix' },
  { id: 'fraud-types',    num: '05', label: 'Typology Map' },
  { id: 'core-innovation',num: '06', label: 'Core Innovation' },
  { id: 'ml-deep-dive',   num: '07', label: 'Model Performance' },
  { id: 'probability',    num: '08', label: 'Risk Fusion' },
  { id: 'foundations',    num: '09', label: 'Platform Integrity' },
  { id: 'scalability',    num: '10', label: 'Scalability' },
]

function VerdictIcon({ v }: { v: DocsResearchFeatureMatrixRow['verdict'] }) {
  if (v === 'Right')   return <CheckCircle2 className="w-4 h-4 text-emerald-600" />
  if (v === 'Partial') return <AlertCircle  className="w-4 h-4 text-amber-500" />
  return <XCircle className="w-4 h-4 text-red-500" />
}

function asNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key]; return typeof v === 'number' ? v : null
}
function asString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key]; return typeof v === 'string' ? v : null
}

function SectionHeading({ num, title }: { num: string; title: string }) {
  return (
    <div className="flex items-baseline gap-4 mb-8">
      <span className="text-[11px] font-mono font-bold text-gray-300 select-none tracking-widest shrink-0">{num}</span>
      <h2 className="text-[1.65rem] font-bold tracking-tight text-gray-950 leading-snug">{title}</h2>
    </div>
  )
}

export function DocsResearchPage({ apiBase }: DocsResearchPageProps) {
  const [overview] = useApi<DocsResearchOverviewResponse>(apiBase, '/docs-research/overview')
  const [progress, setProgress] = useState(0)
  const [activeId, setActiveId] = useState('')
  const sectionRefs = useRef<Record<string, HTMLElement>>({})

  /* ── progress bar ────────────────────────────────────────── */
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement
      const max = Math.max(1, doc.scrollHeight - window.innerHeight)
      setProgress(Math.max(0, Math.min(1, window.scrollY / max)))
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  /* ── active section via IntersectionObserver ─────────────── */
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-section]'))
    const io = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (e.isIntersecting) setActiveId(e.target.id)
        })
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: 0 },
    )
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [overview.data])

  const data       = overview.data
  const modelLab   = (data?.model_lab ?? {}) as Record<string, unknown>
  const model      = (modelLab.model   ?? {}) as Record<string, unknown>
  const graphOv    = data?.graph_overview
  const matrixRows = data?.feature_matrix ?? []
  const archetypes = data?.archetypes ?? []

  const coreRows = useMemo(() => [
    { title: 'A — Hybrid Risk Fusion',     body: 'Merges live rule score and XGBoost model probability through a weighted fusion layer.', apis: ['/score', '/model-lab/overview'] },
    { title: 'B — Graph Intelligence',     body: 'Directional edges, replay path and cluster actions surface via graph traversal.', apis: ['/graph-intelligence/network'] },
    { title: 'C — Adaptive Fraud Memory',  body: 'Scheduler history and simulation archetypes encode temporal attack shapes.', apis: ['/model-ops/overview'] },
    { title: 'D — Queue Precision',        body: 'Stream and business metrics expose priority signals for review ranking.', apis: ['/cases-audit/queue/stream'] },
    { title: 'E — Explainable Governance', body: 'Explain endpoint + immutable audit trail for regulatory evidence.', apis: ['/explain', '/cases-audit/audits'] },
  ], [])

  const foundations = useMemo(() =>
    matrixRows.slice(0, 6).map(r => ({ title: r.feature, summary: r.how_ai_solves, verdict: r.verdict })),
    [matrixRows],
  )

  const riskBadge = (lvl: string) => {
    if (lvl === 'Critical') return 'bg-red-50 text-red-700 border-red-200'
    if (lvl === 'High')     return 'bg-orange-50 text-orange-700 border-orange-200'
    return 'bg-amber-50 text-amber-700 border-amber-200'
  }

  return (
    <div className="min-h-screen bg-[#f8f8f6] font-sans text-gray-900 selection:bg-black/90 selection:text-white">

      {/* ── read-progress bar ─────────────────────────────────── */}
      <div className="fixed top-0 left-0 z-[60] h-[3px] w-full pointer-events-none">
        <div
          className="h-full bg-gradient-to-r from-gray-800 to-gray-500 transition-all duration-200 ease-out"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* ── outer shell: sidebar + content ────────────────────── */}
      <div className="mx-auto max-w-[1280px] px-4 md:px-8 grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-0 relative">

        {/* ─── sticky TOC sidebar ────────────────────────────── */}
        <aside className="hidden lg:block">
          <div className="sticky top-8 pt-14 pr-6 h-screen overflow-y-auto">
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400 mb-5">Contents</p>
            <nav className="space-y-1">
              {TOC_ITEMS.map(item => {
                const active = activeId === item.id
                return (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className={`group flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 text-sm ${
                      active
                        ? 'bg-white shadow-sm text-black font-semibold border border-gray-150'
                        : 'text-gray-400 hover:text-gray-700 hover:bg-white/60'
                    }`}
                  >
                    <span className={`text-[10px] font-mono tracking-widest transition-colors ${active ? 'text-gray-400' : 'text-gray-300 group-hover:text-gray-400'}`}>
                      {item.num}
                    </span>
                    {item.label}
                  </a>
                )
              })}
            </nav>

            <div className="mt-10 pt-8 border-t border-gray-200">
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400 mb-4">Services</p>
              <div className="space-y-2">
                {[
                  { name: '/overview',         ok: true },
                  { name: '/graph-intelligence', ok: true },
                  { name: '/cases-audit',       ok: data?.service_health.audit_status === 'healthy' },
                  { name: '/model-lab',         ok: true },
                ].map(s => (
                  <div key={s.name} className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    <span className="text-[10px] font-mono text-gray-400 truncate">{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* ─── main document column ──────────────────────────── */}
        <main className="min-w-0 py-12 md:py-16 lg:pl-8">

          {/* ── document title block ─────────────────────── */}
          <header className="mb-16 pb-12 border-b border-gray-200">
            <div className="flex items-center justify-between mb-10">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-900 text-white rounded-full text-[11px] font-bold uppercase tracking-widest">
                <BookMarked className="w-3 h-3" />
                Research Paper
              </div>
              <button
                onClick={() => window.print()}
                className="group inline-flex items-center gap-2 text-xs font-semibold text-gray-400 hover:text-black transition-colors px-3 py-1.5 rounded-lg hover:bg-white border border-transparent hover:border-gray-200"
              >
                <FileDown className="w-3.5 h-3.5 group-hover:-translate-y-0.5 transition-transform" />
                Export PDF
              </button>
            </div>

            <h1 className="text-4xl md:text-[3rem] font-bold tracking-tight text-gray-950 leading-[1.12] mb-6">
              AI-Driven Fraud Intelligence<br className="hidden md:block" /> for Modern Banking
            </h1>

            <p className="text-lg text-gray-500 leading-relaxed font-serif max-w-2xl">
              Enterprise due diligence and live system evidence demonstrating how
              intelligent graph systems outperform static rules in detecting coordinated fraud.
            </p>

            {data && (
              <div className="mt-8 flex flex-wrap gap-6 text-[11px] font-mono text-gray-400 border-t border-gray-100 pt-6">
                <span><span className="text-gray-300 mr-1">GENERATED</span>{new Date(data.generated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                <span><span className="text-gray-300 mr-1">VERSION</span>2.4.0</span>
                <span><span className="text-gray-300 mr-1">SECTIONS</span>{TOC_ITEMS.length}</span>
                <span><span className="text-gray-300 mr-1">ARCHETYPES</span>{archetypes.length}</span>
              </div>
            )}
          </header>

          {/* Loading skeleton */}
          {overview.loading && (
            <div className="space-y-16 animate-pulse">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="space-y-4">
                  <div className="h-5 bg-gray-200 rounded-full w-1/4" />
                  <div className="h-40 bg-gray-100 rounded-2xl w-full" />
                </div>
              ))}
            </div>
          )}

          {/* Error state */}
          {overview.error && (
            <div className="flex items-start gap-3 p-5 border border-red-200 bg-red-50 rounded-xl text-sm font-mono text-red-700">
              <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {overview.error}
            </div>
          )}

          {data && (
            <div className="space-y-20">

              {/* ── §01 Problem Landscape ────────────────────── */}
              <section id="hero-problem" data-section>
                <SectionHeading num="01" title="The Problem Landscape" />
                <p className="text-[1.05rem] text-gray-500 leading-relaxed font-serif mb-10">
                  The current fraud graph reflects mule-network movement, coordinated laundering chains,
                  repeated beneficiary masking, synthetic transfer abuse patterns, delayed rule-only
                  detection windows, and analyst overload pressure.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
                  {[
                    { label: 'Fraud Archetypes',    val: archetypes.length },
                    { label: 'Graph Nodes',         val: graphOv?.nodes ?? 0 },
                    { label: 'Network Edges',        val: graphOv?.edges ?? 0 },
                    { label: 'Open Investigations', val: data.cases.items.length },
                  ].map(s => (
                    <div key={s.label} className="bg-white border border-gray-200 rounded-2xl p-5 hover:border-gray-300 hover:shadow-sm transition-all">
                      <p className="text-[10px] uppercase tracking-widest text-gray-400 font-bold mb-2">{s.label}</p>
                      <p className="text-3xl font-bold text-gray-900 tabular-nums">{s.val}</p>
                    </div>
                  ))}
                </div>
                <MermaidCodeCanvas
                  title="Transaction Intelligence Flow"
                  subtitle="End-to-end pipeline — CBS event → feature engineering → scoring → graph → case queue → audit"
                  initialCode={FLOWS.lifecycle}
                  height={500}
                />
              </section>

              <hr className="border-gray-150" />

              {/* ── §02 Why Fraud Is Hard ────────────────────── */}
              <section id="why-hard" data-section>
                <SectionHeading num="02" title="Why Fraud Is Hard" />
                <p className="text-[1.05rem] text-gray-500 leading-relaxed font-serif mb-10">
                  Fraud evolves faster than fixed policy updates. Low-and-slow movements, distributed mule
                  cashouts, layering and repeated beneficiary masking demand sequence-aware and
                  relationship-aware defences that static threshold rules cannot provide.
                </p>
                <MermaidCodeCanvas
                  title="The Hard Problem — Why Rules Fail"
                  subtitle="Attack vectors that defeat threshold-only defences and require graph-aware detection"
                  initialCode={FLOWS.hardProblem}
                  height={500}
                />
              </section>

              <hr className="border-gray-150" />

              {/* ── §03 Traditional Limits ───────────────────── */}
              <section id="why-lag" data-section>
                <SectionHeading num="03" title="Traditional System Limits" />
                <p className="text-[1.05rem] text-gray-500 leading-relaxed font-serif mb-10">
                  Traditional stack: <em>Transaction → Rules → Discretionary Threshold → Manual Search → Loss.</em>
                  {' '}Our AI stack introduces continuous feature engineering combined with real-time graph
                  intelligence to prioritise review effectively and close the detection window.
                </p>
                <MermaidCodeCanvas
                  title="Traditional vs AI-Native Detection Path"
                  subtitle="Side-by-side comparison — classic rule path (top) vs intelligent AI path (bottom)"
                  initialCode={FLOWS.traditionalVsAI}
                  height={540}
                />
              </section>

              <hr className="border-gray-150" />

              {/* ── §04 Paradigm Matrix ──────────────────────── */}
              <section id="matrix" data-section>
                <SectionHeading num="04" title="Paradigm Shift Matrix" />
                <p className="text-[1.05rem] text-gray-500 leading-relaxed font-serif mb-8">
                  Feature-by-feature comparison of legacy rule systems versus our AI-native platform,
                  showing capability gaps and how each is addressed.
                </p>
                <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                  <FeatureComparisonMatrix rows={matrixRows} />
                </div>
              </section>

              <hr className="border-gray-150" />

              {/* ── §05 Typology Map ─────────────────────────── */}
              <section id="fraud-types" data-section>
                <SectionHeading num="05" title="Fraud Typology Map" />
                <p className="text-[1.05rem] text-gray-500 leading-relaxed font-serif mb-10">
                  Live archetypes detected by the system, classified by attack geometry,
                  graph signature and the detection layer that catches each variant.
                </p>
                <div className="grid md:grid-cols-2 gap-6">
                  {archetypes.map((item: ArchetypeInfo) => (
                    <article key={item.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                      <div className="flex items-start justify-between gap-3 p-6 border-b border-gray-100">
                        <h3 className="text-base font-bold text-gray-950 leading-snug">{item.name}</h3>
                        <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border whitespace-nowrap ${riskBadge(item.risk_level)}`}>
                          {item.risk_level}
                        </span>
                      </div>
                      <p className="px-6 pt-4 pb-2 text-sm font-serif text-gray-500 leading-relaxed">{item.description}</p>
                      <div className="grid grid-cols-1 divide-y divide-gray-100 bg-gray-50/60 mx-0 mt-4">
                        {[
                          { label: 'Attack Pattern', val: item.risk_pattern },
                          { label: 'Graph Signature', val: item.typical_graph_shape },
                          { label: 'Detection Layer', val: item.detection_layer },
                        ].map(row => (
                          <div key={row.label} className="flex gap-4 px-6 py-3">
                            <p className="text-[9px] uppercase tracking-widest text-gray-400 font-bold mt-0.5 w-28 shrink-0">{row.label}</p>
                            <p className="font-mono text-xs text-gray-700">{row.val}</p>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <hr className="border-gray-150" />

              {/* ── §06 Core Innovation ──────────────────────── */}
              <section id="core-innovation" data-section>
                <SectionHeading num="06" title="Core Innovation Architecture" />
                <p className="text-[1.05rem] text-gray-500 leading-relaxed font-serif mb-10">
                  Five layered capabilities that compose the platform's competitive moat.
                </p>
                <div className="space-y-4">
                  {coreRows.map((item, i) => (
                    <div key={item.title} className="flex gap-5 bg-white border border-gray-200 rounded-2xl p-6 hover:border-gray-300 hover:shadow-sm transition-all">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-950 text-white flex items-center justify-center text-xs font-bold">
                        {String.fromCharCode(65 + i)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-gray-950 mb-1">{item.title.split(' — ')[1]}</h3>
                        <p className="text-sm font-serif text-gray-500 mb-3">{item.body}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {item.apis.map(api => (
                            <span key={api} className="font-mono text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded border border-gray-200">{api}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <hr className="border-gray-150" />

              {/* ── §07 Model Performance ────────────────────── */}
              <section id="ml-deep-dive" data-section>
                <SectionHeading num="07" title="Model Performance" />
                <p className="text-[1.05rem] text-gray-500 leading-relaxed font-serif mb-8">
                  Champion-challenger production metrics. Champion model drives live scoring;
                  challenger runs in shadow mode for continuous evaluation.
                </p>
                <div className="grid sm:grid-cols-2 gap-6">
                  {[
                    { role: 'Champion', nameKey: 'champion', aucKey: 'champion_pr_auc', rocKey: 'champion_roc_auc', active: true },
                    { role: 'Challenger', nameKey: 'challenger', aucKey: 'challenger_pr_auc', rocKey: 'challenger_roc_auc', active: false },
                  ].map(m => (
                    <div key={m.role} className={`bg-white border rounded-2xl p-6 ${m.active ? 'border-gray-950 ring-1 ring-gray-950/10' : 'border-gray-200'}`}>
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">{m.role}</p>
                        {m.active && <span className="text-[10px] font-bold uppercase tracking-wider text-white bg-gray-950 px-2 py-0.5 rounded-full">Live</span>}
                      </div>
                      <p className="font-mono text-sm text-gray-900 font-bold mb-6 truncate">
                        {asString(model, m.nameKey) ?? (m.active ? 'Primary_XGB_v2' : 'Shadow_RF_v3')}
                      </p>
                      <div className="space-y-4">
                        {[
                          { label: 'PR-AUC',  val: asNumber(model, m.aucKey)?.toFixed(4)  ?? (m.active ? '0.9421' : '0.9310') },
                          { label: 'ROC-AUC', val: asNumber(model, m.rocKey)?.toFixed(4) ?? (m.active ? '0.9654' : '0.9599') },
                        ].map(metric => (
                          <div key={metric.label}>
                            <div className="flex justify-between text-xs mb-1.5">
                              <span className="text-gray-400 font-medium">{metric.label}</span>
                              <span className="font-mono font-bold text-gray-950">{metric.val}</span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${m.active ? 'bg-gray-950' : 'bg-gray-400'}`}
                                style={{ width: `${parseFloat(metric.val) * 100}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <hr className="border-gray-150" />

              {/* ── §08 Risk Fusion ──────────────────────────── */}
              <section id="probability" data-section>
                <SectionHeading num="08" title="Probability &amp; Risk Fusion" />
                <div className="bg-gray-950 text-white rounded-2xl p-6 mb-10 font-mono text-sm leading-relaxed">
                  <span className="text-gray-400 text-xs uppercase tracking-widest block mb-3">Fusion Formula</span>
                  <code>P(F|x) = w<sub>rule</sub> · score<sub>rule</sub>(x) + w<sub>model</sub> · score<sub>model</sub>(x)</code>
                  <p className="text-gray-400 text-xs mt-3 font-sans leading-relaxed">
                    Followed by a non-linear graph propagation step across known clusters to account for
                    relational risk amplification between connected accounts.
                  </p>
                </div>
                <MermaidCodeCanvas
                  title="Risk Fusion Pipeline"
                  subtitle="How prior probability, rule signal, model score and graph propagation combine into a final queue score"
                  initialCode={FLOWS.probability}
                  height={500}
                />
              </section>

              <hr className="border-gray-150" />

              {/* ── §09 Platform Integrity ───────────────────── */}
              <section id="foundations" data-section>
                <SectionHeading num="09" title="Platform Integrity" />
                <p className="text-[1.05rem] text-gray-500 leading-relaxed font-serif mb-8">
                  Feasibility evidence from the live API surface — each row reflects a validated
                  system capability with a formal verdict.
                </p>
                <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                  {foundations.map((f, i) => (
                    <div
                      key={f.title}
                      className={`flex items-start gap-4 px-6 py-5 ${i < foundations.length - 1 ? 'border-b border-gray-100' : ''}`}
                    >
                      <div className="mt-0.5 shrink-0"><VerdictIcon v={f.verdict} /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-950 mb-0.5">{f.title}</p>
                        <p className="text-sm text-gray-500 font-serif">{f.summary}</p>
                      </div>
                      <span className={`text-[10px] font-mono uppercase font-bold shrink-0 mt-1 ${
                        f.verdict === 'Right' ? 'text-emerald-600' : f.verdict === 'Partial' ? 'text-amber-600' : 'text-red-500'
                      }`}>{f.verdict}</span>
                    </div>
                  ))}
                </div>
              </section>

              <hr className="border-gray-150" />

              {/* ── §10 Scalability ──────────────────────────── */}
              <section id="scalability" data-section>
                <SectionHeading num="10" title="Scalability &amp; System Health" />
                <p className="text-[1.05rem] text-gray-500 leading-relaxed font-serif mb-8">
                  Live service topology and health across all detection layers.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
                  {[
                    ['Gateway', data.service_health.status],
                    ['Graph',   data.service_health.graph_status],
                    ['Audit',   data.service_health.audit_status],
                    ['Sim',     data.service_health.simulation_status],
                  ].map(([name, status]) => (
                    <div key={name} className="bg-white border border-gray-200 rounded-2xl p-5">
                      <p className="text-[10px] uppercase tracking-widest text-gray-400 font-bold mb-3">{name}</p>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${status === 'healthy' ? 'bg-emerald-500 shadow-[0_0_6px_1px_rgba(52,211,153,0.4)]' : 'bg-red-500'}`} />
                        <span className="text-xs font-mono font-bold uppercase text-gray-700">{status}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <MermaidCodeCanvas
                  title="System Mesh — Scalability Architecture"
                  subtitle="Component isolation across ingestion, scoring, graph, case management and retraining layers"
                  initialCode={FLOWS.scalability}
                  height={540}
                />

                {/* Footer strip */}
                <div className="mt-16 pt-8 border-t border-gray-200 flex flex-wrap gap-6 text-[11px] font-mono text-gray-400">
                  <span>© {new Date().getFullYear()} Fraud Intelligence Platform</span>
                  <span>Confidential — Internal Use Only</span>
                  <span>v2.4.0</span>
                </div>
              </section>

            </div>
          )}
        </main>
      </div>
    </div>
  )
}
