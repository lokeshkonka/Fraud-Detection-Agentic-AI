import logging
import os
from datetime import datetime
from typing import List, Literal, Optional

from fastapi import FastAPI, HTTPException
from psycopg import Connection
from psycopg.rows import dict_row
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://fraud:fraud@localhost:5432/fraud")

CaseStatus = Literal["open", "investigating", "closed", "escalated"]
Severity = Literal["low", "medium", "high", "critical"]


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


app = FastAPI(title="Audit Service", version="0.3.0")


@app.on_event("startup")
def startup() -> None:
    app.state.db = Connection.connect(DATABASE_URL, autocommit=True, row_factory=dict_row)


@app.on_event("shutdown")
def shutdown() -> None:
    db: Connection = app.state.db
    db.close()


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM audits")
        a = int(cur.fetchone()["c"])
        cur.execute("SELECT COUNT(*) AS c FROM cases")
        c = int(cur.fetchone()["c"])
    return HealthResponse(status="ok", audits=a, cases=c)


@app.get("/audits", response_model=AuditListResponse)
async def audits(limit: int = 100, offset: int = 0) -> AuditListResponse:
    db: Connection = app.state.db
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    with db.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM audits")
        total = int(cur.fetchone()["c"])
        cur.execute(
            "SELECT id::text, actor, action, target, timestamp FROM audits ORDER BY timestamp DESC LIMIT %s OFFSET %s",
            (limit, offset),
        )
        rows = cur.fetchall()
    return AuditListResponse(items=[AuditRecord(**r) for r in rows], total=total, limit=limit, offset=offset)


@app.post("/audits", response_model=AuditAddResponse)
async def add_audit(payload: AuditInput) -> AuditAddResponse:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO audits(actor, action, target, timestamp) VALUES (%s,%s,%s,NOW()) RETURNING id::text, actor, action, target, timestamp",
            (payload.actor, payload.action, payload.target),
        )
        row = cur.fetchone()
    logger.info("audit recorded actor=%s action=%s target=%s", payload.actor, payload.action, payload.target)
    return AuditAddResponse(status="recorded", audit=AuditRecord(**row))


@app.get("/cases", response_model=CaseListResponse)
async def cases(status: Optional[CaseStatus] = None, limit: int = 100, offset: int = 0) -> CaseListResponse:
    db: Connection = app.state.db
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    with db.cursor() as cur:
        if status is None:
            cur.execute("SELECT COUNT(*) AS c FROM cases")
            total = int(cur.fetchone()["c"])
            cur.execute(
                "SELECT id, transaction_id, status, severity, owner, updated_at FROM cases ORDER BY updated_at DESC LIMIT %s OFFSET %s",
                (limit, offset),
            )
        else:
            cur.execute("SELECT COUNT(*) AS c FROM cases WHERE status=%s", (status,))
            total = int(cur.fetchone()["c"])
            cur.execute(
                "SELECT id, transaction_id, status, severity, owner, updated_at FROM cases WHERE status=%s ORDER BY updated_at DESC LIMIT %s OFFSET %s",
                (status, limit, offset),
            )
        rows = cur.fetchall()
    return CaseListResponse(items=[CaseRecord(**r) for r in rows], total=total, limit=limit, offset=offset)


@app.get("/cases/{case_id}", response_model=CaseRecord)
async def get_case(case_id: str) -> CaseRecord:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute("SELECT id, transaction_id, status, severity, owner, updated_at FROM cases WHERE id=%s", (case_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Case {case_id!r} not found")
    return CaseRecord(**row)


@app.patch("/cases/{case_id}/status", response_model=CaseRecord)
async def update_case_status(case_id: str, body: StatusUpdateBody) -> CaseRecord:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute(
            "UPDATE cases SET status=%s, updated_at=NOW() WHERE id=%s RETURNING id, transaction_id, status, severity, owner, updated_at",
            (body.status, case_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Case {case_id!r} not found")
    logger.info("case %s status updated=%s", case_id, body.status)
    return CaseRecord(**row)


@app.post("/cases/upsert", response_model=CaseUpsertResponse)
async def upsert_case(payload: CaseRecord) -> CaseUpsertResponse:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO cases(id, transaction_id, status, severity, owner, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s)
            ON CONFLICT (id) DO UPDATE SET
              transaction_id=EXCLUDED.transaction_id,
              status=EXCLUDED.status,
              severity=EXCLUDED.severity,
              owner=EXCLUDED.owner,
              updated_at=EXCLUDED.updated_at
            RETURNING id, transaction_id, status, severity, owner, updated_at
            """,
            (
                payload.id,
                payload.transaction_id,
                payload.status,
                payload.severity,
                payload.owner,
                payload.updated_at,
            ),
        )
        row = cur.fetchone()
    return CaseUpsertResponse(status="ok", case=CaseRecord(**row))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8800, reload=True)
