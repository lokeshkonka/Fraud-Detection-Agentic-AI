from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Tuple

import pandas as pd


@dataclass
class TemporalSplitResult:
    train: pd.DataFrame
    validation: pd.DataFrame
    test: pd.DataFrame
    metadata: Dict[str, float | int]


def temporal_train_val_test_split(
    df: pd.DataFrame,
    step_col: str = "step",
    sender_col: str = "sender_id",
    ratios: Tuple[float, float, float] = (0.70, 0.15, 0.15),
    burst_gap_steps: int = 24,
) -> TemporalSplitResult:
    """Temporal split with sender-boundary protection to avoid burst leakage.

    Strategy:
    1) Determine temporal boundaries from step distribution.
    2) Build sender burst sessions (new burst if step gap > burst_gap_steps).
    3) Assign each burst to a single split; if a burst crosses boundaries, move it to
       the latest touched split.

    This prevents sender burst leakage while allowing the same sender to appear in
    different windows for distinct, temporally separated behavior episodes.
    """

    if abs(sum(ratios) - 1.0) > 1e-6:
        raise ValueError("ratios must sum to 1.0")

    if step_col not in df.columns:
        raise ValueError(f"Missing step column: {step_col}")
    if sender_col not in df.columns:
        raise ValueError(f"Missing sender column: {sender_col}")

    frame = df.copy().sort_values(step_col).reset_index(drop=True)

    train_q = ratios[0]
    val_q = ratios[0] + ratios[1]
    train_cut = float(frame[step_col].quantile(train_q))
    val_cut = float(frame[step_col].quantile(val_q))

    frame = frame.sort_values([sender_col, step_col]).reset_index(drop=False)
    sender_step_diff = frame.groupby(sender_col)[step_col].diff().fillna(burst_gap_steps + 1)
    new_burst = (sender_step_diff > burst_gap_steps).astype(int)
    frame["_burst_local_id"] = new_burst.groupby(frame[sender_col]).cumsum().astype(int)
    frame["_burst_id"] = frame[sender_col].astype(str) + "_b" + frame["_burst_local_id"].astype(str)

    burst_ranges = (
        frame.groupby("_burst_id")[step_col]
        .agg(burst_min_step="min", burst_max_step="max")
        .reset_index()
    )

    burst_split: Dict[str, str] = {}
    for _, row in burst_ranges.iterrows():
        burst_id = str(row["_burst_id"])
        min_step = float(row["burst_min_step"])
        max_step = float(row["burst_max_step"])

        if max_step <= train_cut:
            burst_split[burst_id] = "train"
        elif min_step > train_cut and max_step <= val_cut:
            burst_split[burst_id] = "validation"
        elif min_step > val_cut:
            burst_split[burst_id] = "test"
        else:
            burst_split[burst_id] = "test" if max_step > val_cut else "validation"

    frame["_split"] = frame["_burst_id"].map(burst_split)
    frame = frame.sort_values("index").drop(columns=["index", "_burst_local_id"]).rename(columns={"_burst_id": "burst_id"})

    train_df = frame.loc[frame["_split"] == "train"].drop(columns=["_split"]).reset_index(drop=True)
    val_df = frame.loc[frame["_split"] == "validation"].drop(columns=["_split"]).reset_index(drop=True)
    test_df = frame.loc[frame["_split"] == "test"].drop(columns=["_split"]).reset_index(drop=True)

    train_bursts = set(train_df["burst_id"].astype(str).unique())
    val_bursts = set(val_df["burst_id"].astype(str).unique())
    test_bursts = set(test_df["burst_id"].astype(str).unique())

    leakage = bool(
        train_bursts.intersection(val_bursts)
        or train_bursts.intersection(test_bursts)
        or val_bursts.intersection(test_bursts)
    )
    if leakage:
        raise RuntimeError("Burst leakage detected across temporal windows")

    metadata: Dict[str, float | int] = {
        "rows_total": int(len(frame)),
        "rows_train": int(len(train_df)),
        "rows_validation": int(len(val_df)),
        "rows_test": int(len(test_df)),
        "pct_train": float(len(train_df) / max(len(frame), 1)),
        "pct_validation": float(len(val_df) / max(len(frame), 1)),
        "pct_test": float(len(test_df) / max(len(frame), 1)),
        "train_cut_step": float(train_cut),
        "validation_cut_step": float(val_cut),
        "burst_gap_steps": int(burst_gap_steps),
        "bursts_train": int(len(train_bursts)),
        "bursts_validation": int(len(val_bursts)),
        "bursts_test": int(len(test_bursts)),
    }

    return TemporalSplitResult(train=train_df, validation=val_df, test=test_df, metadata=metadata)
