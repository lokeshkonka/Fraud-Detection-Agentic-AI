import logging
from datetime import datetime
from typing import List, Literal, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Type aliases / constrained types
# ---------------------------------------------------------------------------

CaseStatus = Literal["open", "investigating", "closed", "escalated"]
Severity = Literal["low", "medium", "high", "critical"]

# ---------------------------------------------------------------------------
# Domain models
# ---------------------------------------------------------------------------


class AuditRecord(BaseModel):
    id: str
    actor: str
    action: str
    target: str
    timestamp: datetime


class CaseRecord(BaseModel):
    id: str
    transaction_id: str
    status: CaseStatus
    severity: Severity
    owner: str
    updated_at: datetime


class AuditInput(BaseModel):
    actor: str
    action: str
    target: str


class StatusUpdateBody(BaseModel):
    status: CaseStatus


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class HealthResponse(BaseModel):
    status: str
    audits: int
    cases: int


class AuditListResponse(BaseModel):
    items: List[AuditRecord]
    total: int
    limit: int
    offset: int


class CaseListResponse(BaseModel):
    items: List[CaseRecord]
    total: int
    limit: int
    offset: int


class AuditAddResponse(BaseModel):
    status: str
    audit: AuditRecord


class CaseUpsertResponse(BaseModel):
    status: str
    case: CaseRecord


# ---------------------------------------------------------------------------
# In-memory store
# ---------------------------------------------------------------------------

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

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Audit Service", version="0.2.0")

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["health"],
    summary="Audit service liveness with current audit and case counts",
)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", audits=len(_audits), cases=len(_cases))


@app.get(
    "/audits",
    response_model=AuditListResponse,
    tags=["audits"],
    summary="Paginated audit log: all actor-action-target records",
)
async def audits(limit: int = 100, offset: int = 0) -> AuditListResponse:
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    total = len(_audits)
    page = _audits[offset : offset + limit]
    return AuditListResponse(items=page, total=total, limit=limit, offset=offset)


@app.post(
    "/audits",
    response_model=AuditAddResponse,
    tags=["audits"],
    summary="Append a new audit log entry",
)
async def add_audit(payload: AuditInput) -> AuditAddResponse:
    record = AuditRecord(
        id=str(len(_audits) + 1),
        actor=payload.actor,
        action=payload.action,
        target=payload.target,
        timestamp=datetime.utcnow(),
    )
    _audits.insert(0, record)
    del _audits[200:]
    logger.info("audit recorded: actor=%s action=%s target=%s", payload.actor, payload.action, payload.target)
    return AuditAddResponse(status="recorded", audit=record)


@app.get(
    "/cases",
    response_model=CaseListResponse,
    tags=["cases"],
    summary="Paginated case list with optional status filter",
)
async def cases(
    status: Optional[CaseStatus] = None,
    limit: int = 100,
    offset: int = 0,
) -> CaseListResponse:
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    filtered = [c for c in _cases if status is None or c.status == status]
    total = len(filtered)
    page = filtered[offset : offset + limit]
    return CaseListResponse(items=page, total=total, limit=limit, offset=offset)


@app.get(
    "/cases/{case_id}",
    response_model=CaseRecord,
    tags=["cases"],
    summary="Retrieve a single fraud case by ID",
)
async def get_case(case_id: str) -> CaseRecord:
    found = next((c for c in _cases if c.id == case_id), None)
    if found is None:
        raise HTTPException(status_code=404, detail=f"Case {case_id!r} not found")
    return found


@app.patch(
    "/cases/{case_id}/status",
    response_model=CaseRecord,
    tags=["cases"],
    summary="Update the status of a fraud case (open → investigating → escalated → closed)",
)
async def update_case_status(case_id: str, body: StatusUpdateBody) -> CaseRecord:
    found = next((c for c in _cases if c.id == case_id), None)
    if found is None:
        raise HTTPException(status_code=404, detail=f"Case {case_id!r} not found")
    found.status = body.status
    found.updated_at = datetime.utcnow()
    logger.info("case %s status updated to %s", case_id, body.status)
    return found


@app.post(
    "/cases/upsert",
    response_model=CaseUpsertResponse,
    tags=["cases"],
    summary="Insert or update a fraud case record",
)
async def upsert_case(payload: CaseRecord) -> CaseUpsertResponse:
    found_idx = next((idx for idx, item in enumerate(_cases) if item.id == payload.id), None)
    if found_idx is None:
        _cases.insert(0, payload)
        logger.info("case created: %s severity=%s", payload.id, payload.severity)
    else:
        _cases[found_idx] = payload
        logger.info("case updated: %s status=%s", payload.id, payload.status)
    del _cases[100:]
    return CaseUpsertResponse(status="ok", case=payload)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8800, reload=True)
