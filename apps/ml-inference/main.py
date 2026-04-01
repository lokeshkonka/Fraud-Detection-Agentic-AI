from datetime import datetime
import math
from typing import List, Optional

from fastapi import FastAPI
from pydantic import BaseModel, Field


class Transaction(BaseModel):
    transaction_id: str
    user_id: str
    amount: float
    merchant: Optional[str] = None
    channel: str = "card"
    timestamp: Optional[datetime] = None
    features: dict = Field(default_factory=dict)


class Score(BaseModel):
    score: float
    label: str
    reasons: List[str]
    model_version: str


app = FastAPI(title="ML Inference", version="0.1.0")

MODEL_VERSION = "xgb_placeholder_v0"


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model_version": MODEL_VERSION}


def logistic(x: float) -> float:
    return 1 / (1 + math.exp(-x))


def simple_features(tx: Transaction) -> dict:
    return {
        "amount_norm": tx.amount / 10000,
        "velocity": tx.features.get("velocity", 0),
        "is_wire": 1.0 if tx.channel in {"wire", "crypto"} else 0.0,
        "merchant_missing": 1.0 if tx.merchant is None else 0.0,
    }


def score_transaction(tx: Transaction) -> Score:
    feats = simple_features(tx)
    logit = (
        1.2 * feats["amount_norm"]
        + 0.6 * feats["velocity"]
        + 1.5 * feats["is_wire"]
        + 0.4 * feats["merchant_missing"]
        - 1.0
    )
    prob = max(0.0, min(0.99, logistic(logit)))
    label = "fraud" if prob >= 0.5 else "legit"
    reasons = [key for key, val in feats.items() if val > 0.8][:3] or ["baseline"]

    return Score(score=round(prob, 4), label=label, reasons=reasons, model_version=MODEL_VERSION)


@app.post("/score", response_model=Score)
async def score(tx: Transaction) -> Score:
    return score_transaction(tx)


@app.get("/model")
async def model_info() -> dict:
    return {"model_version": MODEL_VERSION, "message": "Placeholder XGBoost + GNN ensemble"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8500, reload=True)
