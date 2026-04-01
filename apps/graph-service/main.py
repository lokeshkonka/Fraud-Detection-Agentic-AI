from typing import List

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


app = FastAPI(title="Graph Service", version="0.1.0")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/nodes", response_model=List[GraphNode])
async def nodes() -> List[GraphNode]:
    return [
        GraphNode(id="acct_1", label="account", risk=0.12),
        GraphNode(id="acct_2", label="account", risk=0.72),
    ]


@app.get("/edges", response_model=List[GraphEdge])
async def edges() -> List[GraphEdge]:
    return [
        GraphEdge(source="acct_1", target="acct_2", relation="transfer"),
        GraphEdge(source="acct_2", target="acct_1", relation="refund"),
    ]


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8900, reload=True)
