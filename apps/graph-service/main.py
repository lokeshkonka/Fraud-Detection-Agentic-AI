import logging
import os
from datetime import datetime
from typing import Dict, List, Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
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


class ClusterActionPayload(BaseModel):
    action: Literal["expand_cluster", "isolate_cluster", "trace_inbound_funds", "trace_outbound_funds", "mark_mule_ring_suspicious"]


class ClusterActionResponse(BaseModel):
    cluster_id: str
    action: str
    members: List[str]
    linked_accounts: List[str]
    propagated_risk: Dict[str, float]
    updated_nodes: int


class FreezeResponse(BaseModel):
    entity_id: str
    status: str
    risk_score: float
    updated_at: str


class ReplayStep(BaseModel):
    order: int
    tx_id: str
    source: str
    target: str
    amount: float
    timestamp: str
    risk_score: float
    cumulative_amount: float


class ReplayTimelineResponse(BaseModel):
    seed: str
    steps: List[ReplayStep]
    total_amount: float


app = FastAPI(title="Graph Service", version="0.4.0")


@app.on_event("startup")
def startup() -> None:
    app.state.db = Connection.connect(DATABASE_URL, autocommit=True, row_factory=dict_row)
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute("ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'")
        cur.execute("ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()")


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


def manual_node_state() -> Dict[str, Dict[str, object]]:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute("SELECT id, risk, status FROM graph_nodes")
        rows = cur.fetchall()
    return {str(r["id"]): {"risk": float(r["risk"] or 0.0), "status": str(r["status"] or "active")} for r in rows}


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
    manual = manual_node_state()
    for aid in all_ids:
        risk_score = max_risk.get(aid, 0.05)
        decision = last_decision.get(aid, "approve")
        ntype = infer_account_type(aid, decision, fraud_count.get(aid, 0))
        status = account_status(risk_score, decision)
        if aid in manual:
            risk_score = max(risk_score, float(manual[aid]["risk"]))
            if str(manual[aid]["status"]) in {"frozen", "held", "active", "watch_high", "watch_critical"}:
                status = str(manual[aid]["status"])
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


def compute_rings(nodes: List[GraphNode]) -> List[RingInfo]:
    mule_nodes = [n.id for n in nodes if n.type == "mule"][:12]
    sink_nodes = [n.id for n in nodes if n.type == "sink"][:3]
    rings: List[RingInfo] = []
    if mule_nodes:
        rings.append(RingInfo(id="mule-ring-alpha", members=mule_nodes[:6], risk=0.92))
    if len(mule_nodes) > 6:
        rings.append(RingInfo(id="mule-ring-beta", members=mule_nodes[6:12], risk=0.84))
    if sink_nodes:
        rings.append(RingInfo(id="sink-exit", members=sink_nodes, risk=0.97))
    return rings


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
                INSERT INTO graph_nodes(id, label, risk, status, updated_at)
                VALUES (%s,'customer_account',%s,%s,NOW())
                ON CONFLICT (id) DO UPDATE SET
                  risk = GREATEST(graph_nodes.risk, EXCLUDED.risk),
                  status = CASE WHEN EXCLUDED.status='frozen' THEN 'frozen' ELSE graph_nodes.status END,
                  updated_at = NOW()
                """,
                (user_id, 0.15, "frozen" if str(event.get("decision", "")) == "freeze" else "active"),
            )
            cur.execute(
                """
                INSERT INTO graph_nodes(id, label, risk, status, updated_at)
                VALUES (%s,'beneficiary_account',%s,%s,NOW())
                ON CONFLICT (id) DO UPDATE SET
                  risk = GREATEST(graph_nodes.risk, EXCLUDED.risk),
                  status = CASE WHEN EXCLUDED.status='frozen' THEN 'frozen' ELSE graph_nodes.status END,
                  updated_at = NOW()
                """,
                (target, 0.10, "frozen" if str(event.get("decision", "")) == "freeze" else "active"),
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
    return RingsResponse(rings=compute_rings(nodes))


@app.post("/clusters/{cluster_id}/actions", response_model=ClusterActionResponse)
async def cluster_action(cluster_id: str, payload: ClusterActionPayload) -> ClusterActionResponse:
    edges = tx_edges_from_transactions(2500)
    nodes = compute_nodes_from_edges(edges)
    rings = compute_rings(nodes)
    ring = next((r for r in rings if r.id == cluster_id), None)
    if not ring:
        raise HTTPException(status_code=404, detail=f"cluster {cluster_id!r} not found")

    member_set = set(ring.members)
    linked: set[str] = set()
    for e in edges:
        if e.source in member_set:
            linked.add(e.target)
        if e.target in member_set:
            linked.add(e.source)
    linked_accounts = sorted(linked - member_set)[:40]

    propagated: Dict[str, float] = {}
    for nid in list(member_set) + linked_accounts:
        related = [e for e in edges if e.source == nid or e.target == nid]
        if not related:
            propagated[nid] = 0.1
            continue
        risk = sum(e.risk_score for e in related) / max(1, len(related))
        if nid in member_set:
            risk = min(0.99, risk + 0.12)
        propagated[nid] = round(risk, 4)

    db: Connection = app.state.db
    updated = 0
    with db.cursor() as cur:
        if payload.action == "mark_mule_ring_suspicious":
            for nid in member_set:
                cur.execute(
                    """
                    INSERT INTO graph_nodes(id, label, risk, status, updated_at)
                    VALUES (%s,'mule',0.92,'watch_critical',NOW())
                    ON CONFLICT (id) DO UPDATE SET risk=GREATEST(graph_nodes.risk, 0.92), status='watch_critical', updated_at=NOW()
                    """,
                    (nid,),
                )
                updated += 1

    if payload.action == "isolate_cluster":
        linked_accounts = []
    elif payload.action == "trace_inbound_funds":
        linked_accounts = sorted({e.source for e in edges if e.target in member_set})[:40]
    elif payload.action == "trace_outbound_funds":
        linked_accounts = sorted({e.target for e in edges if e.source in member_set})[:40]
    elif payload.action == "expand_cluster":
        linked_accounts = linked_accounts[:60]

    return ClusterActionResponse(
        cluster_id=cluster_id,
        action=payload.action,
        members=ring.members,
        linked_accounts=linked_accounts,
        propagated_risk=propagated,
        updated_nodes=updated,
    )


@app.post("/threat-entities/{entity_id}/freeze", response_model=FreezeResponse)
async def freeze_entity(entity_id: str) -> FreezeResponse:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO graph_nodes(id, label, risk, status, updated_at)
            VALUES (%s, 'frozen_account', 0.99, 'frozen', NOW())
            ON CONFLICT (id) DO UPDATE SET
              risk = GREATEST(graph_nodes.risk, 0.99),
              status = 'frozen',
              updated_at = NOW()
            RETURNING id, risk, status, updated_at
            """,
            (entity_id,),
        )
        row = cur.fetchone()
    return FreezeResponse(
        entity_id=str(row["id"]),
        status=str(row["status"]),
        risk_score=float(row["risk"]),
        updated_at=row["updated_at"].isoformat().replace("+00:00", "Z"),
    )


@app.post("/threat-entities/{entity_id}/rollback", response_model=FreezeResponse)
async def rollback_entity(entity_id: str) -> FreezeResponse:
    db: Connection = app.state.db
    with db.cursor() as cur:
        cur.execute(
            """
            UPDATE graph_nodes
            SET status='active', risk=LEAST(risk, 0.65), updated_at=NOW()
            WHERE id=%s
            RETURNING id, risk, status, updated_at
            """,
            (entity_id,),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"entity {entity_id!r} not found")
    return FreezeResponse(
        entity_id=str(row["id"]),
        status=str(row["status"]),
        risk_score=float(row["risk"]),
        updated_at=row["updated_at"].isoformat().replace("+00:00", "Z"),
    )


@app.get("/replay-path", response_model=ReplayTimelineResponse)
async def replay_path(seed: str = "demo_victim_01", limit: int = 20) -> ReplayTimelineResponse:
    limit = max(4, min(limit, 60))
    edges = tx_edges_from_transactions(3000)
    suspicious = [e for e in edges if e.is_fraud or e.risk_score >= 0.8 or e.frozen_path]
    suspicious.sort(key=lambda e: e.timestamp)
    path: List[GraphEdge] = []

    cursor = seed
    used_tx: set[str] = set()
    for _ in range(limit):
        nxt = next((e for e in suspicious if e.source == cursor and e.tx_id not in used_tx), None)
        if not nxt:
            nxt = next((e for e in suspicious if e.source == cursor), None)
        if not nxt:
            break
        path.append(nxt)
        used_tx.add(nxt.tx_id)
        cursor = nxt.target

    if not path:
        fallback = suspicious[: min(limit, len(suspicious))]
        if not fallback:
            return ReplayTimelineResponse(seed=seed, steps=[], total_amount=0.0)
        path = fallback

    steps: List[ReplayStep] = []
    cumulative = 0.0
    for i, e in enumerate(path, start=1):
        cumulative += float(e.amount)
        steps.append(
            ReplayStep(
                order=i,
                tx_id=e.tx_id,
                source=e.source,
                target=e.target,
                amount=float(e.amount),
                timestamp=e.timestamp,
                risk_score=float(e.risk_score),
                cumulative_amount=round(cumulative, 2),
            )
        )
    return ReplayTimelineResponse(seed=seed, steps=steps, total_amount=round(cumulative, 2))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8900, reload=True)
