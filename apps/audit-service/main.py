from datetime import datetime
from typing import List

from fastapi import FastAPI
from pydantic import BaseModel


class AuditRecord(BaseModel):
    id: str
    actor: str
    action: str
    target: str
    timestamp: datetime


class CaseRecord(BaseModel):
    id: str
    transaction_id: str
    status: str
    severity: str
    owner: str
    updated_at: datetime


class AuditInput(BaseModel):
    actor: str
    action: str
    target: str


app = FastAPI(title="Audit Service", version="0.2.0")

_audits: List[AuditRecord] = [
    AuditRecord(id="1", actor="system", action="score", target="txn_123", timestamp=datetime.utcnow()),
    AuditRecord(id="2", actor="analyst", action="approve", target="case_456", timestamp=datetime.utcnow()),
]

_cases: List[CaseRecord] = [
    CaseRecord(
        id="case_001",
        transaction_id="txn_123",
        status="open",
        severity="high",
        owner="fraud-ops",
        updated_at=datetime.utcnow(),
    )
]


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "audits": len(_audits), "cases": len(_cases)}


@app.get("/audits")
async def audits() -> List[AuditRecord]:
    return _audits[:100]


@app.post("/audits")
async def add_audit(payload: AuditInput) -> dict:
    record = AuditRecord(
        id=str(len(_audits) + 1),
        actor=payload.actor,
        action=payload.action,
        target=payload.target,
        timestamp=datetime.utcnow(),
    )
    _audits.insert(0, record)
    del _audits[200:]
    return {"status": "recorded", "audit": record.model_dump()}


@app.get("/cases")
async def cases() -> List[CaseRecord]:
    return _cases[:100]


@app.post("/cases/upsert")
async def upsert_case(payload: CaseRecord) -> dict:
    found = next((idx for idx, item in enumerate(_cases) if item.id == payload.id), None)
    if found is None:
        _cases.insert(0, payload)
    else:
        _cases[found] = payload
    del _cases[100:]
    return {"status": "ok", "case": payload.model_dump()}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8800, reload=True)
