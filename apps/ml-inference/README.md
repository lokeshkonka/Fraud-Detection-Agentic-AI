# ML Inference Service

FastAPI service that scores transactions. Currently a lightweight logistic heuristic that will be replaced by XGBoost + GraphSAGE ensemble.

## Run locally

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8500
```
