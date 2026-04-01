# API Gateway

FastAPI gateway that fronts scoring, streaming, and audit routes. Currently returns a heuristic fraud score while the ml-inference service is stubbed.

## Run locally

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
