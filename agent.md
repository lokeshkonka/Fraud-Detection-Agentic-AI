# custom-agent.md --- Master Engineering Agent Operating Manual

> Purpose: This file is the **single source of truth for any AI coding
> agent** working on the Fraud Detection Command Center.

------------------------------------------------------------------------

# 🎯 Mission

Build an **enterprise-grade, bank-realistic fraud intelligence
platform** with: - real-time fraud scoring - simulation engine - graph
intelligence - explainable ML - scheduled retraining - Dockerized
microservices - production-grade UI - ideathon-winning demo polish

The system must feel like: \> **Stripe Radar × Datadog × Microsoft
Sentinel × bank SOC**

Never build flashy fake dashboards. Prioritize **enterprise realism**.

------------------------------------------------------------------------

# 🧱 System Architecture (authoritative)

## Backend layers

1.  **Layer 0 --- Ingestion**
    -   API gateway
    -   Kafka event stream
    -   Redis online feature cache
    -   session hydration
    -   latency target \< 5 ms
2.  **Layer 1 --- Probabilistic Rules**
    -   weighted heuristics
    -   Bayesian posterior
    -   Poisson velocity
    -   Markov journey checks
    -   normalized risk score \[0,1\]
3.  **Layer 2 --- ML Inference**
    -   XGBoost champion
    -   Logistic Regression baseline
    -   Random Forest baseline
    -   Graph risk / mule detection
    -   SHAP explanations
    -   stacked final score
4.  **Layer 3 --- Decision**
    -   approve
    -   step-up auth
    -   hold
    -   freeze
    -   create case
5.  **Layer 4 --- Governance**
    -   drift
    -   retraining
    -   challenger vs champion
    -   rollback
    -   audit logs
6.  **Layer 5 --- Simulation**
    -   create N accounts
    -   create N transactions
    -   inject fraud archetypes
    -   live graph sync

------------------------------------------------------------------------

# 💻 Frontend Best Practices

## Stack

-   React
-   TypeScript
-   TailwindCSS
-   Cytoscape.js
-   TanStack Table
-   Apache ECharts
-   Framer Motion
-   Zustand
-   React Query
-   Radix UI

## UI design rules

-   enterprise dark theme
-   subtle aurora accents only
-   8px spacing grid
-   max radius 12px
-   dense tables
-   timestamps everywhere
-   no giant empty hero cards
-   projector-safe contrast
-   mobile-first responsiveness
-   1920x1080 demo optimized

## Mandatory routes

-   /dashboard
-   /transaction-flow
-   /simulation-lab
-   /graph-intelligence
-   /model-lab
-   /model-ops
-   /cases-audit
-   /rule-studio

------------------------------------------------------------------------

# 🧠 ML + Notebook Best Practices

## Notebook order

1.  01_dataset_prep
2.  02_xgb_regression_rf_training
3.  03_model_comparison_and_thresholds
4.  04_shap_and_feature_importance
5.  05_weekly_retrain_and_drift
6.  06_graph_risk_and_mule_detection

## Training rules

-   use PR-AUC over accuracy
-   preserve fraud ratio 1%
-   compare 3 baseline models minimum
-   export thresholds.json
-   persist SHAP cache
-   save EDA artifacts
-   track cumulative fraud catch curve
-   use outlier-aware engineered features
-   compare log(amount) variants

## Feature engineering

Mandatory: - amount_log - balance_delta_org - balance_delta_dest -
txns_last_2min - ring_risk_score - shared_device_count -
outlier_flag_amount - mean_shift_score

------------------------------------------------------------------------

# 🐳 Backend + Docker Best Practices

## Services

-   gateway
-   simulation-engine
-   ml-inference
-   ml-retrain-scheduler
-   graph-service
-   audit-service
-   postgres
-   neo4j
-   redis
-   kafka
-   nginx

## Rules

-   every service must have Dockerfile
-   expose health endpoint
-   structured JSON logging
-   pydantic schemas everywhere
-   websocket stream for live txns
-   retry Kafka consumers
-   mount /models volume
-   persist /artifacts

------------------------------------------------------------------------

# 📊 Data + EDA Best Practices

Always generate: - histograms - boxplots - feature mean/variance - fraud
prevalence - outlier ratio - cumulative accuracy curve

Persist:

``` txt
artifacts/
├── eda/
├── model_eval/
├── shap/
└── drift/
```

Use these for: - model-lab UI - model-ops drift baseline - retrain
promotion logic

------------------------------------------------------------------------

# 🎬 Demo Best Practices

## Winning flow

dashboard → simulation-lab → graph-intelligence → transaction-flow →
model-lab → model-ops

## Must-show moments

-   create 200 accounts
-   inject fraud
-   red frozen node pulse
-   live table update
-   SHAP explanation
-   retrain countdown
-   challenger promotion

------------------------------------------------------------------------

# ✅ Coding Standards

-   strict TypeScript
-   typed API responses
-   no any
-   reusable UI primitives
-   service layer abstraction
-   feature folders
-   no inline magic constants
-   central config
-   unit tests for scoring logic
-   notebook outputs reproducible

------------------------------------------------------------------------

# 🚫 Hard constraints

Never: - break route contracts - use toy neon UI - ignore mobile - use
raw SQL strings when ORM/schema exists - optimize for accuracy alone -
hide latency metrics - remove audit trails - fake graph data in UI
without backend sync

------------------------------------------------------------------------

# 🏁 Definition of Done

A task is complete only when: - backend service works - UI wired -
Docker builds - notebook updated - metrics visible - mobile works - demo
scenario passes - screenshot captured - docs updated
