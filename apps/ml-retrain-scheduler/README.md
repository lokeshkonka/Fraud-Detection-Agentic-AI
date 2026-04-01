# ML Retrain Scheduler

Placeholder scheduler service that triggers a mock retrain loop on a fixed cadence. The interval is short for dev/demo; set to weekly when wiring real jobs.

## Run locally

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8700
```
