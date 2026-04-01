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


app = FastAPI(title="Audit Service", version="0.1.0")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/audits", response_model=List[AuditRecord])
async def audits() -> List[AuditRecord]:
    now = datetime.utcnow()
    return [
        AuditRecord(id="1", actor="system", action="score", target="txn_123", timestamp=now),
        AuditRecord(id="2", actor="analyst", action="approve", target="case_456", timestamp=now),
    ]


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8800, reload=True)
