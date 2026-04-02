import logging
import os
from typing import List

from fastapi import FastAPI
from psycopg import Connection
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://fraud:fraud@localhost:5432/fraud")


class GraphNode(BaseModel):
    id: str
    label: str
    risk: float = Field(..., ge=0.0, le=1.0)


class GraphEdge(BaseModel):
    source: str
    target: str
    relation: str
    amount: float = Field(..., ge=0.0)


class SyncPayload(BaseModel):
    events: List[dict]


class HealthResponse(BaseModel):
    status: str
    nodes: int
    edges: int


class GraphOverviewResponse(BaseModel):
    nodes: int
    edges: int
    high_risk_nodes: int
    mule_ring_signals: int


class RingInfo(BaseModel):
    id: str
    members: List[str]
    risk: float


class RingsResponse(BaseModel):
    rings: List[RingInfo]


class SyncResponse(BaseModel):
    status: str
    added_edges: int
    total_nodes: int
    total_edges: int


app = FastAPI(title="Graph Service", version="0.3.0")


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
        cur.execute("SELECT COUNT(*) AS c FROM graph_nodes")
        n = int(cur.fetchone()["c"])
        cur.execute("SELECT COUNT(*) AS c FROM graph_edges")
        e = int(cur.fetchone()["c"])
    return HealthResponse(status="ok", nodes=n, edges=e)


@app.get("/nodes", response_model=List[GraphNode])
async def nodes(limit: int = 100, min_risk: float = 0.0) -> List[GraphNode]:
    db: Connection = app.state.db
    limit = max(1, min(limit, 5000))
    min_risk = max(0.0, min(min_risk, 1.0))
    with db.cursor() as cur:
        cur.execute(
            "SELECT id, label, risk FROM graph_nodes WHERE risk >= %s ORDER BY risk DESC LIMIT %s",
            (min_risk, limit),
        )
        rows = cur.fetchall()
    return [GraphNode(**r) for r in rows]


@app.get("/edges", response_model=List[GraphEdge])
async def edges(limit: int = 200) -> List[GraphEdge]:
    db: Connection = app.state.db
    limit = max(1, min(limit, 10000))
    with db.cursor() as cur:
        cur.execute("SELECT source, target, relation, amount FROM graph_edges ORDER BY id DESC LIMIT %s", (limit,))
        rows = cur.fetchall()
    return [GraphEdge(**r) for r in rows]


@app.post("/sync-events", response_model=SyncResponse)
async def sync_events(payload: SyncPayload) -> SyncResponse:
    db: Connection = app.state.db
    added_edges = 0
    with db.cursor() as cur:
        for event in payload.events[:200]:
            user_id = str(event.get("user_id", "unknown_user"))
            merchant = str(event.get("merchant", "unknown_merchant"))
            amount = float(event.get("amount", 0.0))
            label = str(event.get("label", "legit"))
            merchant_node_id = f"merchant_{merchant}"

            cur.execute(
                """
                INSERT INTO graph_nodes(id, label, risk)
                VALUES (%s,'account',%s)
                ON CONFLICT (id) DO NOTHING
                """,
                (user_id, 0.15),
            )
            cur.execute(
                """
                INSERT INTO graph_nodes(id, label, risk)
                VALUES (%s,'merchant',%s)
                ON CONFLICT (id) DO NOTHING
                """,
                (merchant_node_id, 0.05),
            )
            if label == "fraud":
                cur.execute("UPDATE graph_nodes SET risk = LEAST(0.99, risk + 0.12) WHERE id=%s", (user_id,))

            cur.execute(
                "INSERT INTO graph_edges(source, target, relation, amount) VALUES (%s,%s,'payment',%s)",
                (user_id, merchant_node_id, amount),
            )
            added_edges += 1

        cur.execute("DELETE FROM graph_edges WHERE id IN (SELECT id FROM graph_edges ORDER BY id DESC OFFSET 1000)")

        cur.execute("SELECT COUNT(*) AS c FROM graph_nodes")
        total_nodes = int(cur.fetchone()["c"])
        cur.execute("SELECT COUNT(*) AS c FROM graph_edges")
        total_edges = int(cur.fetchone()["c"])

    logger.info("sync-events: added_edges=%d total_nodes=%d total_edges=%d", added_edges, total_nodes, total_edges)
    return SyncResponse(status="synced", added_edges=added_edges, total_nodes=total_nodes, total_edges=total_edges)


@app.get("/overview", response_model=GraphOverviewResponse)
async def overview() -> GraphOverviewResponse:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM graph_nodes")
        n = int(cur.fetchone()["c"])
        cur.execute("SELECT COUNT(*) AS c FROM graph_edges")
        e = int(cur.fetchone()["c"])
        cur.execute("SELECT COUNT(*) AS c FROM graph_nodes WHERE risk >= 0.7")
        high_risk = int(cur.fetchone()["c"])
    return GraphOverviewResponse(nodes=n, edges=e, high_risk_nodes=high_risk, mule_ring_signals=max(1, high_risk // 2))


@app.get("/rings", response_model=RingsResponse)
async def rings() -> RingsResponse:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute("SELECT id FROM graph_nodes WHERE risk >= 0.7 ORDER BY risk DESC LIMIT 8")
        risky_nodes = [r["id"] for r in cur.fetchall()]

    return RingsResponse(
        rings=[
            RingInfo(id="ring-a", members=risky_nodes[:4], risk=0.88 if risky_nodes[:4] else 0.0),
            RingInfo(id="ring-b", members=risky_nodes[4:8], risk=0.79 if risky_nodes[4:8] else 0.0),
        ]
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8900, reload=True)
