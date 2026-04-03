const zlib = require('zlib');
const fs = require('fs');

async function downloadMermaid(text, filename) {
  const data = Buffer.from(text, 'utf8');
  const compressed = zlib.deflateSync(data);
  const base64 = compressed.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const url = `https://kroki.io/mermaid/png/${base64}`;
  
  const res = await fetch(url);
  if (!res.ok) {
     const txt = await res.text();
     console.error("Failed", filename, txt);
     return;
  }
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(filename, Buffer.from(arrayBuffer));
}

const FLOWS = {
  lifecycle: `flowchart LR\n    A[Transaction event] --> B[Feature engineering]\n    B --> C[Rule fusion]\n    C --> D[XGBoost inference]\n    D --> E[Graph intelligence]\n    E --> F[Queue prioritization]\n    F --> G[Case automation]\n    G --> H[Audit evidence]`,
  hardProblem: `flowchart TD\n    A[Low-and-slow behavior] --> D[Rules miss sequence context]\n    B[Distributed mule accounts] --> D\n    C[Beneficiary masking] --> D\n    D --> E[Graph risk propagates across entities]\n    E --> F[Analyst overload without ranked queue]`,
  traditionalVsAI: `flowchart LR\n    T1[Transaction] --> T2[Static Rules]\n    T2 --> T3[Threshold]\n    T3 --> T4[Manual Review]\n    T4 --> T5[Delayed Detection]\n    T5 --> T6[Loss]\n\n    A1[Transaction] --> A2[Feature Engineering]\n    A2 --> A3[Rule Fusion]\n    A3 --> A4[XGBoost]\n    A4 --> A5[Graph Intelligence]\n    A5 --> A6[Queue Gain]\n    A6 --> A7[Case Automation]`,
  coreInnovation: `flowchart LR\n    I[Ingestion] --> F[Hybrid risk fusion]\n    F --> G[Graph intelligence]\n    G --> M[Adaptive fraud memory]\n    M --> Q[Queue precision intelligence]\n    Q --> E[Explainable governance]`,
  scalability: `flowchart LR\n    CBS[CBS / Payment rails] --> BUS[Event Ingestion Layer]\n    BUS --> RULE[Rule Engine]\n    RULE --> XGB[XGBoost Scoring]\n    XGB --> GRAPH[Graph Engine]\n    GRAPH --> CASE[Case Queue]\n    CASE --> SOC[SOC / Analyst Ops]\n    SOC --> AUDIT[Immutable Audit]\n    AUDIT --> RETRAIN[Retrain Scheduler]`,
  probability: `flowchart LR\n    P0["Prior p(Fraud)"] --> P1[Likelihood from rule signals]\n    P1 --> P2[Model probability]\n    P2 --> P3[Graph propagation adjustment]\n    P3 --> P4[Queue risk expectation]`
};

const main = async () => {
    for (const [key, value] of Object.entries(FLOWS)) {
        await downloadMermaid(value, `/home/loki/Codespace/Fraud-Detection-Agentic-AI/apps/web-dashboard/public/${key}.png`);
        console.log("Downloaded", key);
    }
}
main();
