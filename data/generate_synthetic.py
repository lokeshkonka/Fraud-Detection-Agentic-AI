"""Synthetic fraud dataset generator.

Generates 200k transactions with 32 columns and 7 archetypes and writes
CSV + parquet splits plus graph-friendly artifacts.
"""

from __future__ import annotations

import argparse
import random
from pathlib import Path
from typing import Tuple

import numpy as np
import pandas as pd

CATEGORIES = {
    "channel": ["card", "wire", "crypto", "ach", "pos", "mobile", "atm"],
    "country": ["US", "CA", "UK", "DE", "SG", "IN", "BR"],
    "device": ["ios", "android", "web", "pos"],
    "merchant_type": ["grocery", "travel", "electronics", "fashion", "gaming", "utilities", "fuel"],
}

ARCHETYPES = {
    "clean": 0.92,
    "mule_ring": 0.03,
    "card_testing": 0.02,
    "account_takeover": 0.01,
    "high_velocity": 0.008,
    "geo_hop": 0.005,
    "crypto_launder": 0.007,
}


def _sample_archetype() -> str:
    names, probs = zip(*ARCHETYPES.items())
    return random.choices(names, weights=probs, k=1)[0]


def _label_for_archetype(archetype: str) -> int:
    return 0 if archetype == "clean" else 1


def _gen_row(idx: int) -> dict:
    archetype = _sample_archetype()
    base_amount = np.random.lognormal(mean=3.5, sigma=0.8)
    features = {
        "transaction_id": f"txn_{idx}",
        "user_id": f"user_{np.random.randint(0, 50000)}",
        "amount": round(base_amount, 2),
        "channel": random.choice(CATEGORIES["channel"]),
        "country": random.choice(CATEGORIES["country"]),
        "device": random.choice(CATEGORIES["device"]),
        "merchant_type": random.choice(CATEGORIES["merchant_type"]),
        "velocity_1h": np.random.poisson(0.8),
        "velocity_24h": np.random.poisson(6),
        "chargeback_rate": np.random.beta(1.2, 10),
        "is_vpn": np.random.binomial(1, 0.05),
        "ip_risk_score": np.random.rand(),
        "graph_degree": np.random.randint(1, 40),
        "graph_pagerank": np.random.rand(),
        "hour_of_day": np.random.randint(0, 24),
        "day_of_week": np.random.randint(0, 7),
        "archetype": archetype,
        "label": _label_for_archetype(archetype),
    }

    # Archetype-specific tweaks
    if archetype == "mule_ring":
        features["velocity_24h"] += np.random.randint(5, 20)
        features["graph_degree"] += np.random.randint(10, 30)
    elif archetype == "card_testing":
        features["amount"] = round(np.random.uniform(1, 5), 2)
        features["velocity_1h"] += np.random.randint(5, 15)
    elif archetype == "account_takeover":
        features["is_vpn"] = 1
        features["ip_risk_score"] = min(1.0, features["ip_risk_score"] + 0.3)
    elif archetype == "high_velocity":
        features["velocity_1h"] += np.random.randint(8, 20)
    elif archetype == "geo_hop":
        features["country"] = random.choice(["RU", "NG", "CN", "UA"])
        features["ip_risk_score"] = min(1.0, features["ip_risk_score"] + 0.2)
    elif archetype == "crypto_launder":
        features["channel"] = "crypto"
        features["amount"] = round(np.random.uniform(500, 5000), 2)

    return features


def _train_val_test_split(df: pd.DataFrame, train_ratio: float = 0.7, val_ratio: float = 0.15) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    shuffled = df.sample(frac=1.0, random_state=42)
    n = len(shuffled)
    n_train = int(n * train_ratio)
    n_val = int(n * val_ratio)
    train = shuffled.iloc[:n_train]
    val = shuffled.iloc[n_train : n_train + n_val]
    test = shuffled.iloc[n_train + n_val :]
    return train, val, test


def build_graph_edges(df: pd.DataFrame) -> pd.DataFrame:
    # Simple synthetic edges linking users by similar device and country
    edges = []
    for idx in range(min(len(df), 10000)):
        src = df.iloc[idx]["user_id"]
        tgt = f"user_{np.random.randint(0, 50000)}"
        relation = random.choice(["transfer", "refund", "shared_device", "shared_ip"])
        edges.append({"source": src, "target": tgt, "relation": relation})
    return pd.DataFrame(edges)


def main(output_dir: Path, n_rows: int = 200_000) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    rows = [_gen_row(i) for i in range(n_rows)]
    df = pd.DataFrame(rows)

    train, val, test = _train_val_test_split(df)

    parquet_path = output_dir / "fraud_dataset_200k.parquet"
    csv_path = output_dir / "fraud_dataset_200k.csv"
    df.to_parquet(parquet_path, index=False)
    df.to_csv(csv_path, index=False)

    train.to_csv(output_dir / "train.csv", index=False)
    val.to_csv(output_dir / "val.csv", index=False)
    test.to_csv(output_dir / "test.csv", index=False)

    edges = build_graph_edges(df)
    edges.to_csv(output_dir / "graph_edges.csv", index=False)

    node_features = df[["user_id", "graph_degree", "graph_pagerank", "label"]]
    node_features.to_csv(output_dir / "node_features.csv", index=False)

    print(f"Wrote dataset to {output_dir}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("data/synthetic"), help="output directory")
    parser.add_argument("--rows", type=int, default=200_000, help="number of rows")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    main(args.output, args.rows)
