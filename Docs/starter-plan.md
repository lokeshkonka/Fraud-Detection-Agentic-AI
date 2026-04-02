# starter-plan.md --- AI Agent Bootstrap Plan for GitHub Codespaces

## 🎯 Mission

Use **GitHub Codespaces for heavy computation + scaffolding first**,
then shift lightweight UI polish and local testing to laptop.

This plan is optimized for: - high CPU / RAM work in cloud - parallel
backend scaffolding - dataset generation - ML training - Docker
multi-service bootstrapping - graph seed generation - repo structure
generation

------------------------------------------------------------------------

# 🚀 Phase 1 --- Heavy tasks FIRST (Codespaces)

These should be completed in cloud before touching laptop.

## 1) Monorepo scaffolding

Create full repo:

``` txt
apps/
packages/
infra/
Docs/
data/
models/
planner-layer/
```

Generate: - React + TS + Tailwind app - FastAPI gateway - ML inference
service - simulation engine - retrain scheduler - docker-compose - nginx
config

------------------------------------------------------------------------

## 2) Synthetic dataset generation (HIGH PRIORITY)

Generate: - **200,000 transactions** - **32 columns** - **7 fraud
archetypes** - CSV + parquet - train/val/test split - graph edge list -
node feature matrix

Output:

``` txt
data/synthetic/
├── fraud_dataset_200k.csv
├── fraud_dataset_200k.parquet
├── train.csv
├── val.csv
├── test.csv
├── graph_edges.csv
└── node_features.csv
```

------------------------------------------------------------------------

## 3) Train heavy ML models

Run in Codespaces: - XGBoost champion - LightGBM challenger - GraphSAGE
GNN - SHAP explainer cache - threshold optimizer - drift baseline
snapshot

Artifacts:

``` txt
models/
├── xgb.joblib
├── gnn_fraud_v1.pt
├── shap_explainer.pkl
├── thresholds.json
└── drift_baseline.json
```

------------------------------------------------------------------------

## 4) Docker multi-service boot

Heavy container tasks: - postgres - neo4j - redis - kafka - ml service -
simulation engine - api-gateway - scheduler

Validate:

``` bash
docker compose up --build
```

------------------------------------------------------------------------

## 5) Graph seed generation

Precompute: - 200 accounts - 5 mule rings - suspicious clusters - 10k
transaction edges - frozen node scenarios

Store:

``` txt
data/graph-seeds/
```

------------------------------------------------------------------------

# 💻 Phase 2 --- Laptop tasks (lighter)

After cloud finishes, do these locally.

## UI polish

-   animations
-   spacing
-   typography
-   responsive fixes
-   mobile bottom sheets
-   projector QA

## Demo preparation

-   screenshots
-   seed scenarios
-   pitch flow
-   freeze animation timing
-   chart labels

## Final testing

-   localhost UI feel
-   mobile responsiveness
-   presentation click-path

------------------------------------------------------------------------

# 🤖 AI Agent strict execution order

1.  repo scaffold
2.  dataset generation
3.  ML train + export
4.  docker compose boot
5.  graph seeds
6.  websocket simulation
7.  UI route placeholders
8.  handoff to laptop

------------------------------------------------------------------------

# ✅ Definition of done

Codespaces work is complete when: - repo boots - models exported -
docker services healthy - graph seed exists - 8 routes compile -
simulation stream works - docs linked
