import logging
import os
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import FastAPI
from psycopg import Connection
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://fraud:fraud@localhost:5432/fraud")


class GraphNode(BaseModel):
    id: str
    type: str
    status: str
    risk_score: float = Field(..., ge=0.0, le=1.0)
    total_in: float = 0.0
    total_out: float = 0.0
    shared_devices: int = 0
    fraud_history: int = 0
    linked_cases: int = 0
    # backward-compatible fields used by current frontend
    label: str
    risk: float = Field(..., ge=0.0, le=1.0)


class GraphEdge(BaseModel):
    source: str
    target: str
    relation: str
    amount: float = Field(..., ge=0.0)
    tx_id: str
    timestamp: str
    channel: str
    risk_score: float = Field(..., ge=0.0, le=1.0)
    decision: str
    is_fraud: bool
    suspicious_burst: bool = False
    frozen_path: bool = False
    case_link: Optional[str] = None


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


app = FastAPI(title="Graph Service", version="0.4.0")


@app.on_event("startup")
def startup() -> None:
    app.state.db = Connection.connect(DATABASE_URL, autocommit=True, row_factory=dict_row)


@app.on_event("shutdown")
def shutdown() -> None:
    db: Connection = app.state.db
    db.close()


def infer_account_type(account_id: str, decision: str, fraud_count: int) -> str:
    aid = account_id.lower()
    if "sink" in aid:
        return "sink"
    if "mule" in aid:
        return "mule"
    if "merchant_" in aid:
        return "merchant"
    if "device" in aid:
        return "shared_device_hub"
    if decision == "freeze":
        return "frozen_account"
    if fraud_count > 0 and ("beneficiary" in aid or "dest" in aid):
        return "beneficiary"
    return "customer_account"


def account_status(risk_score: float, latest_decision: str) -> str:
    if latest_decision == "freeze":
        return "frozen"
    if latest_decision == "hold":
        return "held"
    if risk_score >= 0.85:
        return "watch_critical"
    if risk_score >= 0.65:
        return "watch_high"
    return "active"


def tx_edges_from_transactions(limit: int) -> List[GraphEdge]:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute(
            """
            SELECT transaction_id, user_id, amount, merchant, channel, score, label, decision, timestamp
            FROM transactions
            ORDER BY timestamp DESC
            LIMIT %s
            """,
            (limit,),
        )
        rows = cur.fetchall()

    edges: List[GraphEdge] = []
    for r in rows:
        tx_id = str(r["transaction_id"] or "")
        source = str(r["user_id"] or "unknown_sender")
        raw_merchant = str(r["merchant"] or "").strip()
        # Money-flow storytelling: sender -> beneficiary/mule/sink/merchant
        if raw_merchant == "wallet_topup":
            if "demo_mule_ring_08" in source:
                target = "sink_account_01"
            elif "demo_victim_" in source:
                target = "demo_mule_ring_03"
            elif "demo_mule_ring_" in source:
                target = "demo_mule_ring_08"
            else:
                target = "beneficiary_wallet_topup"
        elif raw_merchant:
            target = f"merchant_{raw_merchant}"
        else:
            target = "beneficiary_unknown"

        score_val = float(r["score"] or 0.0)
        decision = str(r["decision"] or "approve")
        label = str(r["label"] or "legit")
        ts: datetime = r["timestamp"] if isinstance(r["timestamp"], datetime) else datetime.utcnow()

        edges.append(
            GraphEdge(
                source=source,
                target=target,
                relation="transfer",
                amount=float(r["amount"] or 0.0),
                tx_id=tx_id,
                timestamp=ts.isoformat().replace("+00:00", "Z"),
                channel=str(r["channel"] or "card"),
                risk_score=score_val,
                decision=decision,
                is_fraud=(label == "fraud"),
                suspicious_burst=(score_val >= 0.8 and str(r["channel"] or "") in {"card", "upi", "wire"}),
                frozen_path=(decision == "freeze"),
                case_link=f"/cases-audit?tx_id={tx_id}" if decision in {"hold", "freeze"} else None,
            )
        )
    return edges


def compute_nodes_from_edges(edges: List[GraphEdge]) -> List[GraphNode]:
    in_sum: Dict[str, float] = {}
    out_sum: Dict[str, float] = {}
    fraud_count: Dict[str, int] = {}
    last_decision: Dict[str, str] = {}
    max_risk: Dict[str, float] = {}
    linked_cases: Dict[str, int] = {}

    for e in edges:
        out_sum[e.source] = out_sum.get(e.source, 0.0) + e.amount
        in_sum[e.target] = in_sum.get(e.target, 0.0) + e.amount
        if e.is_fraud:
            fraud_count[e.source] = fraud_count.get(e.source, 0) + 1
            fraud_count[e.target] = fraud_count.get(e.target, 0) + 1
        max_risk[e.source] = max(max_risk.get(e.source, 0.05), e.risk_score)
        max_risk[e.target] = max(max_risk.get(e.target, 0.05), e.risk_score * 0.9)
        if e.decision in {"hold", "freeze"}:
            linked_cases[e.source] = linked_cases.get(e.source, 0) + 1
            linked_cases[e.target] = linked_cases.get(e.target, 0) + 1
        last_decision[e.source] = e.decision
        last_decision[e.target] = e.decision if e.decision in {"hold", "freeze"} else last_decision.get(e.target, "approve")

    all_ids = set(in_sum) | set(out_sum)
    nodes: List[GraphNode] = []
    for aid in all_ids:
        risk_score = max_risk.get(aid, 0.05)
        decision = last_decision.get(aid, "approve")
        ntype = infer_account_type(aid, decision, fraud_count.get(aid, 0))
        status = account_status(risk_score, decision)
        label = ntype.replace("_", " ")
        nodes.append(
            GraphNode(
                id=aid,
                type=ntype,
                status=status,
                risk_score=round(min(0.99, risk_score), 4),
                total_in=round(in_sum.get(aid, 0.0), 2),
                total_out=round(out_sum.get(aid, 0.0), 2),
                shared_devices=1 if "device" in aid else 0,
                fraud_history=fraud_count.get(aid, 0),
                linked_cases=linked_cases.get(aid, 0),
                label=label,
                risk=round(min(0.99, risk_score), 4),
            )
        )

    # keep performant
    nodes.sort(key=lambda n: n.risk_score, reverse=True)
    return nodes[:220]


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    edges = tx_edges_from_transactions(1200)
    nodes = compute_nodes_from_edges(edges)
    return HealthResponse(status="ok", nodes=len(nodes), edges=len(edges))


@app.get("/nodes", response_model=List[GraphNode])
async def nodes(limit: int = 200, min_risk: float = 0.0) -> List[GraphNode]:
    limit = max(1, min(limit, 300))
    min_risk = max(0.0, min(min_risk, 1.0))
    edges = tx_edges_from_transactions(1500)
    out = [n for n in compute_nodes_from_edges(edges) if n.risk_score >= min_risk]
    return out[:limit]


@app.get("/edges", response_model=List[GraphEdge])
async def edges(limit: int = 400) -> List[GraphEdge]:
    limit = max(1, min(limit, 1000))
    out = tx_edges_from_transactions(limit)
    return out


@app.post("/sync-events", response_model=SyncResponse)
async def sync_events(payload: SyncPayload) -> SyncResponse:
    db: Connection = app.state.db
    added_edges = 0
    with db.cursor() as cur:
        for event in payload.events[:500]:
            user_id = str(event.get("user_id", "unknown_sender"))
            merchant = str(event.get("merchant", "")).strip()
            amount = float(event.get("amount", 0.0))
            relation = "transfer"
            target = f"merchant_{merchant}" if merchant else "beneficiary_unknown"
            cur.execute(
                """
                INSERT INTO graph_nodes(id, label, risk)
                VALUES (%s,'customer_account',%s)
                ON CONFLICT (id) DO NOTHING
                """,
                (user_id, 0.15),
            )
            cur.execute(
                """
                INSERT INTO graph_nodes(id, label, risk)
                VALUES (%s,'beneficiary_account',%s)
                ON CONFLICT (id) DO NOTHING
                """,
                (target, 0.10),
            )
            cur.execute(
                "INSERT INTO graph_edges(source, target, relation, amount) VALUES (%s,%s,%s,%s)",
                (user_id, target, relation, amount),
            )
            added_edges += 1

        cur.execute("DELETE FROM graph_edges WHERE id IN (SELECT id FROM graph_edges ORDER BY id DESC OFFSET 3000)")
        cur.execute("SELECT COUNT(*) AS c FROM graph_nodes")
        total_nodes = int(cur.fetchone()["c"])
        cur.execute("SELECT COUNT(*) AS c FROM graph_edges")
        total_edges = int(cur.fetchone()["c"])

    logger.info("sync-events: added_edges=%d total_nodes=%d total_edges=%d", added_edges, total_nodes, total_edges)
    return SyncResponse(status="synced", added_edges=added_edges, total_nodes=total_nodes, total_edges=total_edges)


@app.get("/overview", response_model=GraphOverviewResponse)
async def overview() -> GraphOverviewResponse:
    edges = tx_edges_from_transactions(2000)
    nodes = compute_nodes_from_edges(edges)
    high_risk = sum(1 for n in nodes if n.risk_score >= 0.7)
    mule_signals = sum(1 for n in nodes if n.type in {"mule", "sink"})
    return GraphOverviewResponse(
        nodes=len(nodes),
        edges=len(edges),
        high_risk_nodes=high_risk,
        mule_ring_signals=max(1, mule_signals),
    )


@app.get("/rings", response_model=RingsResponse)
async def rings() -> RingsResponse:
    edges = tx_edges_from_transactions(2000)
    nodes = compute_nodes_from_edges(edges)
    mule_nodes = [n.id for n in nodes if n.type == "mule"][:12]
    sink_nodes = [n.id for n in nodes if n.type == "sink"][:3]
    rings: List[RingInfo] = []
    if mule_nodes:
        rings.append(RingInfo(id="mule-ring-alpha", members=mule_nodes[:6], risk=0.92))
    if len(mule_nodes) > 6:
        rings.append(RingInfo(id="mule-ring-beta", members=mule_nodes[6:12], risk=0.84))
    if sink_nodes:
        rings.append(RingInfo(id="sink-exit", members=sink_nodes, risk=0.97))
    return RingsResponse(rings=rings)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8900, reload=True)
