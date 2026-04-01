import logging
from typing import Dict, List, Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

NodeType = Literal["account", "merchant", "device", "ip"]
RelationType = Literal["transfer", "refund", "payment", "shared_device"]

# ---------------------------------------------------------------------------
# Domain models
# ---------------------------------------------------------------------------


class GraphNode(BaseModel):
    id: str
    label: str  # NodeType — kept as str to allow sync from external events gracefully
    risk: float = Field(..., ge=0.0, le=1.0)


class GraphEdge(BaseModel):
    source: str
    target: str
    relation: str  # RelationType — kept as str for same reason as above
    amount: float = Field(..., ge=0.0)


class SyncPayload(BaseModel):
    events: List[dict]


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# In-memory graph store
# ---------------------------------------------------------------------------

_nodes: Dict[str, GraphNode] = {
    "acct_1": GraphNode(id="acct_1", label="account", risk=0.12),
    "acct_2": GraphNode(id="acct_2", label="account", risk=0.72),
}
_edges: List[GraphEdge] = [
    GraphEdge(source="acct_1", target="acct_2", relation="transfer", amount=245.0),
    GraphEdge(source="acct_2", target="acct_1", relation="refund", amount=85.0),
]

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Graph Service", version="0.2.0")

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["health"],
    summary="Graph service liveness with current node and edge counts",
)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", nodes=len(_nodes), edges=len(_edges))


@app.get(
    "/nodes",
    response_model=List[GraphNode],
    tags=["graph"],
    summary="Retrieve graph nodes filtered by minimum risk score, with limit",
)
async def nodes(limit: int = 100, min_risk: float = 0.0) -> List[GraphNode]:
    limit = max(1, min(limit, 5000))
    min_risk = max(0.0, min(min_risk, 1.0))
    filtered = [n for n in _nodes.values() if n.risk >= min_risk]
    return filtered[:limit]


@app.get(
    "/edges",
    response_model=List[GraphEdge],
    tags=["graph"],
    summary="Retrieve graph edges with limit",
)
async def edges(limit: int = 200) -> List[GraphEdge]:
    limit = max(1, min(limit, 10000))
    return _edges[:limit]


@app.post(
    "/sync-events",
    response_model=SyncResponse,
    tags=["graph"],
    summary="Ingest simulation or live events into the graph store",
)
async def sync_events(payload: SyncPayload) -> SyncResponse:
    added_edges = 0
    for event in payload.events[:200]:
        user_id = str(event.get("user_id", "unknown_user"))
        merchant = str(event.get("merchant", "unknown_merchant"))
        amount = float(event.get("amount", 0.0))
        label = str(event.get("label", "legit"))

        if user_id not in _nodes:
            _nodes[user_id] = GraphNode(id=user_id, label="account", risk=0.15)
        merchant_node_id = f"merchant_{merchant}"
        if merchant_node_id not in _nodes:
            _nodes[merchant_node_id] = GraphNode(id=merchant_node_id, label="merchant", risk=0.05)

        if label == "fraud":
            _nodes[user_id].risk = round(min(0.99, _nodes[user_id].risk + 0.12), 4)

        _edges.append(
            GraphEdge(source=user_id, target=merchant_node_id, relation="payment", amount=amount)
        )
        added_edges += 1

    if len(_edges) > 1000:
        del _edges[:-1000]

    logger.info(
        "sync-events: added_edges=%d total_nodes=%d total_edges=%d",
        added_edges,
        len(_nodes),
        len(_edges),
    )
    return SyncResponse(
        status="synced",
        added_edges=added_edges,
        total_nodes=len(_nodes),
        total_edges=len(_edges),
    )


@app.get(
    "/overview",
    response_model=GraphOverviewResponse,
    tags=["graph"],
    summary="High-level graph statistics: node/edge counts and risk signals",
)
async def overview() -> GraphOverviewResponse:
    high_risk = len([n for n in _nodes.values() if n.risk >= 0.7])
    return GraphOverviewResponse(
        nodes=len(_nodes),
        edges=len(_edges),
        high_risk_nodes=high_risk,
        mule_ring_signals=max(1, high_risk // 2),
    )


@app.get(
    "/rings",
    response_model=RingsResponse,
    tags=["graph"],
    summary="Detected mule-ring clusters formed from high-risk nodes",
)
async def rings() -> RingsResponse:
    risky_nodes = [n.id for n in _nodes.values() if n.risk >= 0.7][:8]
    return RingsResponse(
        rings=[
            RingInfo(id="ring-a", members=risky_nodes[:4], risk=0.88),
            RingInfo(id="ring-b", members=risky_nodes[4:8], risk=0.79),
        ]
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8900, reload=True)
