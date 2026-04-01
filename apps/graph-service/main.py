from typing import Dict, List

from fastapi import FastAPI
from pydantic import BaseModel


class GraphNode(BaseModel):
    id: str
    label: str
    risk: float


class GraphEdge(BaseModel):
    source: str
    target: str
    relation: str
    amount: float


class SyncPayload(BaseModel):
    events: List[dict]


app = FastAPI(title="Graph Service", version="0.2.0")

_nodes: Dict[str, GraphNode] = {
    "acct_1": GraphNode(id="acct_1", label="account", risk=0.12),
    "acct_2": GraphNode(id="acct_2", label="account", risk=0.72),
}
_edges: List[GraphEdge] = [
    GraphEdge(source="acct_1", target="acct_2", relation="transfer", amount=245.0),
    GraphEdge(source="acct_2", target="acct_1", relation="refund", amount=85.0),
]


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "nodes": len(_nodes), "edges": len(_edges)}


@app.get("/nodes")
async def nodes() -> List[GraphNode]:
    return list(_nodes.values())


@app.get("/edges")
async def edges() -> List[GraphEdge]:
    return _edges


@app.post("/sync-events")
async def sync_events(payload: SyncPayload) -> dict:
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
            _nodes[user_id].risk = min(0.99, _nodes[user_id].risk + 0.12)

        _edges.append(GraphEdge(source=user_id, target=merchant_node_id, relation="payment", amount=amount))
        added_edges += 1

    del _edges[:-1000]

    return {
        "status": "synced",
        "added_edges": added_edges,
        "total_nodes": len(_nodes),
        "total_edges": len(_edges),
    }


@app.get("/overview")
async def overview() -> dict:
    high_risk = len([n for n in _nodes.values() if n.risk >= 0.7])
    return {
        "nodes": len(_nodes),
        "edges": len(_edges),
        "high_risk_nodes": high_risk,
        "mule_ring_signals": max(1, high_risk // 2),
    }


@app.get("/rings")
async def rings() -> dict:
    risky_nodes = [n.id for n in _nodes.values() if n.risk >= 0.7][:8]
    return {
        "rings": [
            {
                "id": "ring-a",
                "members": risky_nodes[:4],
                "risk": 0.88,
            },
            {
                "id": "ring-b",
                "members": risky_nodes[4:8],
                "risk": 0.79,
            },
        ]
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8900, reload=True)
