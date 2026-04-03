# Fraud-Detection-Agentic-AI

Bootstrapped monorepo for an agentic fraud detection platform. This repo follows the starter plan in Docs/starter-plan.md and is scaffolded for heavy Codespaces work first, then local UI polish.

## Structure

- apps/ — service apps (`api-gateway`, `ml-inference`, `simulation-engine`, `ml-retrain-scheduler`, `audit-service`, `graph-service`, `web-dashboard`)
- packages/ — shared libraries (placeholders for now)
- infra/ — infra configs (Nginx, compose)
- data/ — synthetic data + graph seeds
- models/ — trained model artifacts
- Docs/ — architecture and plans
- planner-layer/ — future per-layer execution notes

## Dev quickstart

- Install Docker and run `docker compose up --build` to bring up `api-gateway`, `ml-inference`, `simulation-engine`, `ml-retrain-scheduler`, `graph-service`, `audit-service`, `web-dashboard`, and supporting stores.
- Web UI runs on http://localhost:3000 (or http://localhost via Nginx), API gateway on http://localhost:8000.
- Individual Python services can be run with `pip install -r requirements.txt && uvicorn main:app --reload --port <port>` from each `apps/*` folder.

## Local model training (venv, no Colab)

Use the unified local training pipeline from the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r models/requirements-local-train.txt
python models/train_pipeline.py
```

Optional: point to your dataset path.

```bash
export FRAUD_DATA_PATH=data/processed/transactions.parquet
```

Expected outputs:
- `artifacts/eda/*`
- `artifacts/model_eval/*`
- `artifacts/shap/*`
- `artifacts/drift/drift_baseline.json`
- `models/lr.joblib`, `models/rf.joblib`, `models/xgb.joblib` (if XGBoost installed)

Shortcut:

```bash
bash scripts/train_local_venv.sh
```

## Next steps

1) Enrich service code paths (routing, Kafka, Redis, PostgreSQL, Neo4j)
2) Wire model artifacts into ml-inference and add SHAP cache
3) Generate synthetic datasets and seed graph data under data/
4) Train models and export artifacts into models/
