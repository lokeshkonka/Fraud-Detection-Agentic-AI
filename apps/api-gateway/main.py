from contextlib import asynccontextmanager
from datetime import datetime
import os
import random
from typing import Any, Dict, List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import httpx
from pydantic import BaseModel, Field


class Transaction(BaseModel):
    transaction_id: str
    user_id: str
    amount: float
    merchant: Optional[str] = None
    channel: str = "card"
    timestamp: Optional[datetime] = None
    features: Dict[str, Any] = Field(default_factory=dict)


class ScoreResponse(BaseModel):
    score: float
    label: str
    reasons: List[str]


ML_INFERENCE_URL = os.getenv("ML_INFERENCE_URL", "http://localhost:8500").rstrip("/")
ML_INFERENCE_TIMEOUT_SEC = float(os.getenv("ML_INFERENCE_TIMEOUT_SEC", "2.5"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http_client = httpx.AsyncClient(timeout=ML_INFERENCE_TIMEOUT_SEC)
    yield
    await app.state.http_client.aclose()


app = FastAPI(title="Fraud API Gateway", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    inference_status = "degraded"
    try:
        inference_resp = await app.state.http_client.get(f"{ML_INFERENCE_URL}/health")
        if inference_resp.is_success:
            inference_status = "ok"
    except httpx.HTTPError:
        inference_status = "degraded"

    return {
        "status": "ok",
        "inference_status": inference_status,
        "ml_inference_url": ML_INFERENCE_URL,
    }


def heuristic_score(tx: Transaction) -> ScoreResponse:
    base = min(0.99, 0.02 + (tx.amount / 10000))
    reasons: List[str] = []

    if tx.channel in {"wire", "crypto"}:
        base += 0.12
        reasons.append("high_risk_channel")
    if tx.merchant is None:
        base += 0.05
        reasons.append("missing_merchant")
    if tx.features.get("velocity", 0) > 3:
        base += 0.08
        reasons.append("high_velocity")

    jitter = random.uniform(-0.02, 0.02)
    score = max(0.0, min(0.99, base + jitter))
    label = "fraud" if score >= 0.5 else "legit"

    return ScoreResponse(score=round(score, 4), label=label, reasons=reasons or ["baseline"])


@app.post("/score", response_model=ScoreResponse)
async def score(tx: Transaction) -> ScoreResponse:
    try:
        inference_resp = await app.state.http_client.post(
            f"{ML_INFERENCE_URL}/score",
            json=tx.model_dump(mode="json"),
        )
        inference_resp.raise_for_status()
        payload = inference_resp.json()
        return ScoreResponse(
            score=float(payload["score"]),
            label=str(payload["label"]),
            reasons=list(payload.get("reasons") or ["model_response"]),
        )
    except (httpx.HTTPError, KeyError, TypeError, ValueError):
        return heuristic_score(tx)


@app.get("/routes")
async def routes() -> dict:
    return {"routes": [r.path for r in app.routes]}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
