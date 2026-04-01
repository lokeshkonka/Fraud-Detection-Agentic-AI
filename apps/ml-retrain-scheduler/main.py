import asyncio
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI


app = FastAPI(title="ML Retrain Scheduler", version="0.1.0")

RUN_INTERVAL_SECONDS = 60 * 60  # placeholder: hourly; adjust to 7d in prod
_next_run: Optional[datetime] = None


async def retrain_job() -> None:
    global _next_run
    # TODO: trigger actual training pipeline + validation
    now = datetime.utcnow()
    print(f"[retrain] started at {now.isoformat()}Z")
    await asyncio.sleep(1)
    print(f"[retrain] completed at {datetime.utcnow().isoformat()}Z")
    _next_run = datetime.utcnow() + timedelta(seconds=RUN_INTERVAL_SECONDS)


async def scheduler_loop() -> None:
    global _next_run
    _next_run = datetime.utcnow() + timedelta(seconds=RUN_INTERVAL_SECONDS)
    while True:
        await retrain_job()
        await asyncio.sleep(RUN_INTERVAL_SECONDS)


@app.on_event("startup")
async def start_scheduler() -> None:
    asyncio.create_task(scheduler_loop())


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "next_run": _next_run}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8700, reload=True)
