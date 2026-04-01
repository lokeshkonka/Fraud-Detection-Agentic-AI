import logging
import random
import string
from datetime import datetime, timedelta
from typing import Dict, List

from fastapi import FastAPI
from pydantic import BaseModel, Field

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Domain models
# ---------------------------------------------------------------------------


class SimConfig(BaseModel):
    count: int = Field(default=20, ge=1, le=500)
    start_seconds_ago: int = Field(default=300, ge=0, le=86400)
    max_amount: float = Field(default=3000.0, gt=0, le=1_000_000)
    fraud_ratio: float = Field(default=0.12, ge=0.0, le=1.0)


class SimEvent(BaseModel):
    transaction_id: str
    user_id: str
    amount: float
    merchant: str
    channel: str
    timestamp: datetime
    label: str
    archetype: str


class SimSummary(BaseModel):
    generated: int
    fraud: int
    legit: int
    fraud_ratio: float


class SimRunResponse(BaseModel):
    events: List[SimEvent]
    summary: SimSummary
    generated_at: datetime


class ArchetypeInfo(BaseModel):
    id: str
    description: str
    risk_level: str


class ArchetypesResponse(BaseModel):
    archetypes: List[str]


class HealthResponse(BaseModel):
    status: str
    archetypes: List[str]


class LastRunResponse(BaseModel):
    events: List[Dict]
    summary: SimSummary
    generated_at: str


# ---------------------------------------------------------------------------
# Static data
# ---------------------------------------------------------------------------

FRAUD_ARCHETYPES = [
    "mule_ring",
    "account_takeover",
    "friendly_fraud",
    "cross_border_smurfing",
    "merchant_collusion",
    "synthetic_identity",
    "velocity_burst",
]

ARCHETYPE_METADATA: List[ArchetypeInfo] = [
    ArchetypeInfo(
        id="mule_ring",
        description=(
            "High-risk account network forwarding illicit funds across multiple hops "
            "to obscure the beneficial owner before cash-out."
        ),
        risk_level="critical",
    ),
    ArchetypeInfo(
        id="account_takeover",
        description=(
            "Credential-based compromise enabling an attacker to initiate unauthorised "
            "fund transfers from a legitimate account holder's profile."
        ),
        risk_level="high",
    ),
    ArchetypeInfo(
        id="friendly_fraud",
        description=(
            "A cardholder disputes a legitimate transaction as unauthorised to obtain "
            "a chargeback while retaining goods or services."
        ),
        risk_level="medium",
    ),
    ArchetypeInfo(
        id="cross_border_smurfing",
        description=(
            "Structured below-threshold transfers split across multiple jurisdictions "
            "to evade AML monitoring and currency reporting obligations."
        ),
        risk_level="high",
    ),
    ArchetypeInfo(
        id="merchant_collusion",
        description=(
            "Coordinated refund inflation or fictitious charge manipulation executed "
            "in concert with a complicit merchant terminal."
        ),
        risk_level="high",
    ),
    ArchetypeInfo(
        id="synthetic_identity",
        description=(
            "Fraudulent identity constructed by combining real personally identifiable "
            "information with fabricated data to pass KYC checks."
        ),
        risk_level="critical",
    ),
    ArchetypeInfo(
        id="velocity_burst",
        description=(
            "Rapid sequential transaction bursts designed to exhaust an account balance "
            "or credit line before fraud controls detect and block the pattern."
        ),
        risk_level="high",
    ),
]

CHANNELS = ["card", "wire", "crypto", "ach", "upi"]
MERCHANTS = ["groceries", "travel", "electronics", "fashion", "gaming", "wallet_topup"]

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Simulation Engine", version="0.2.0")

_last_run: Dict = {
    "events": [],
    "summary": {"generated": 0, "fraud": 0, "legit": 0, "fraud_ratio": 0.0},
    "generated_at": datetime.utcnow().isoformat() + "Z",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _id(prefix: str = "txn") -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=10))
    return f"{prefix}_{suffix}"


def _archetype(is_fraud: bool) -> str:
    if not is_fraud:
        return "normal_behavior"
    return random.choice(FRAUD_ARCHETYPES)


def _event(now: datetime, max_amount: float, is_fraud: bool) -> SimEvent:
    channel = random.choice(CHANNELS)
    amount = round(random.uniform(5, max_amount), 2)

    if is_fraud:
        channel = random.choice(["wire", "crypto", "upi"])
        amount = round(random.uniform(max_amount * 0.45, max_amount), 2)

    return SimEvent(
        transaction_id=_id(),
        user_id=_id("user"),
        amount=amount,
        merchant=random.choice(MERCHANTS),
        channel=channel,
        timestamp=now - timedelta(seconds=random.randint(0, 300)),
        label="fraud" if is_fraud else "legit",
        archetype=_archetype(is_fraud),
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["health"],
    summary="Simulation engine liveness and supported fraud archetypes",
)
def health() -> HealthResponse:
    return HealthResponse(status="ok", archetypes=FRAUD_ARCHETYPES)


@app.get(
    "/archetypes",
    response_model=ArchetypesResponse,
    tags=["archetypes"],
    summary="List all supported fraud archetype identifiers",
)
def archetypes() -> ArchetypesResponse:
    return ArchetypesResponse(archetypes=FRAUD_ARCHETYPES)


@app.get(
    "/archetypes/detail",
    response_model=List[ArchetypeInfo],
    tags=["archetypes"],
    summary="Detailed descriptions and risk levels for every fraud archetype",
)
def archetypes_detail() -> List[ArchetypeInfo]:
    return ARCHETYPE_METADATA


@app.post(
    "/simulate",
    response_model=SimRunResponse,
    tags=["simulation"],
    summary="Generate a synthetic fraud/legit event mix based on the supplied configuration",
)
async def simulate(cfg: SimConfig) -> SimRunResponse:
    now = datetime.utcnow()
    count = max(1, min(cfg.count, 500))
    fraud_ratio = max(0.0, min(cfg.fraud_ratio, 1.0))

    events: List[SimEvent] = []
    for _ in range(count):
        is_fraud = random.random() < fraud_ratio
        events.append(_event(now, cfg.max_amount, is_fraud))

    fraud_count = len([item for item in events if item.label == "fraud"])
    summary = SimSummary(
        generated=count,
        fraud=fraud_count,
        legit=count - fraud_count,
        fraud_ratio=round(fraud_count / count, 4),
    )
    generated_at = datetime.utcnow()

    _last_run["events"] = [e.model_dump(mode="json") for e in events]
    _last_run["summary"] = summary.model_dump()
    _last_run["generated_at"] = generated_at.isoformat() + "Z"

    logger.info(
        "simulation complete: count=%d fraud=%d legit=%d",
        count,
        fraud_count,
        count - fraud_count,
    )

    return SimRunResponse(events=events, summary=summary, generated_at=generated_at)


@app.get(
    "/simulate/last",
    tags=["simulation"],
    summary="Return the most recently completed simulation run",
)
async def last_run() -> Dict:
    return _last_run


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8600, reload=True)
