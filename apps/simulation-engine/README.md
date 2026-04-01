# Simulation Engine

Generates synthetic transaction events. Currently returns a batch of events via REST; future work will push to Kafka.

## Run locally

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8600
```
