# Fraud-Detection-Agentic-AI

Bootstrapped monorepo for an agentic fraud detection platform. This repo follows the starter plan in Docs/starter-plan.md and is scaffolded for heavy Codespaces work first, then local UI polish.

## Structure

- apps/ — service apps (gateway, inference, simulation, scheduler, audit, graph, web dashboard)
- packages/ — shared libraries (placeholders for now)
- infra/ — infra configs (Nginx, compose)
- data/ — synthetic data + graph seeds
- models/ — trained model artifacts
- Docs/ — architecture and plans
- planner-layer/ — future per-layer execution notes

## Dev quickstart

- Install Docker and run `docker compose up --build` to bring up gateway, inference, simulation, scheduler, graph, audit, dashboard, and supporting stores.
- Web UI runs on http://localhost:3000 (or http://localhost via Nginx), API gateway on http://localhost:8000.
- Individual Python services can be run with `pip install -r requirements.txt && uvicorn main:app --reload --port <port>` from each `apps/*` folder.

## Next steps

1) Enrich service code paths (routing, Kafka, Redis, PostgreSQL, Neo4j)
2) Wire model artifacts into ml-inference and add SHAP cache
3) Generate synthetic datasets and seed graph data under data/
4) Train models and export artifacts into models/