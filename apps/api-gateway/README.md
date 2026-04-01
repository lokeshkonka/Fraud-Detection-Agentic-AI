# API Gateway

FastAPI gateway that fronts scoring, streaming, and audit routes.

- `/score` now forwards transaction payloads to `ml-inference`.
- If upstream inference is unavailable or returns an invalid payload, the gateway falls back to a local heuristic score so scoring remains available.
- `/health` reports both gateway status and an `inference_status` probe result.

## Run locally

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
