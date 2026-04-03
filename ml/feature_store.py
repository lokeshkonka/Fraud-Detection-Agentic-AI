from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Deque, Dict, Tuple

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin


@dataclass
class FeatureStoreConfig:
    """Configuration for leakage-safe temporal feature generation."""

    short_window: int = 5
    long_window: int = 24
    burst_window: int = 3


def _prune(window: Deque[Tuple[int, float]], current_step: int, horizon: int) -> None:
    lower = current_step - horizon
    while window and window[0][0] < lower:
        window.popleft()


class FeatureStoreV2(BaseEstimator, TransformerMixin):
    """Builds behavioral, graph, novelty, and rule-based features without leakage."""

    def __init__(self, config: FeatureStoreConfig = FeatureStoreConfig()) -> None:
        self.config = config

    def fit(self, X: pd.DataFrame, y: pd.Series | None = None) -> "FeatureStoreV2":
        return self

    def transform(self, X: pd.DataFrame) -> pd.DataFrame:
        return self.build_feature_store(X)

    def build_feature_store(self, df: pd.DataFrame) -> pd.DataFrame:
        required = {"step", "amount", "sender_id", "receiver_id", "device_id", "geo_bucket"}
        missing = required.difference(df.columns)
        if missing:
            raise ValueError(f"Missing required columns for feature store: {sorted(missing)}")

        frame = df.copy()
        frame = frame.sort_values(["step", "transaction_id"] if "transaction_id" in frame.columns else ["step"]).reset_index(drop=False)

        sender_short_window: Dict[str, Deque[Tuple[int, float]]] = defaultdict(deque)
        sender_long_window: Dict[str, Deque[Tuple[int, float]]] = defaultdict(deque)
        sender_long_receivers: Dict[str, Deque[Tuple[int, str]]] = defaultdict(deque)
        receiver_long_window: Dict[str, Deque[Tuple[int, float]]] = defaultdict(deque)
        sender_recent_steps: Dict[str, Deque[int]] = defaultdict(deque)

        sender_seen_receivers: Dict[str, set[str]] = defaultdict(set)
        sender_seen_devices: Dict[str, set[str]] = defaultdict(set)
        sender_seen_geos: Dict[str, set[str]] = defaultdict(set)

        sender_neighbors: Dict[str, set[str]] = defaultdict(set)
        receiver_sources: Dict[str, set[str]] = defaultdict(set)
        receiver_cashout_counter: Dict[str, int] = defaultdict(int)
        receiver_total_seen: Dict[str, int] = defaultdict(int)

        sender_count: Dict[str, int] = defaultdict(int)
        sender_amount_sum: Dict[str, float] = defaultdict(float)
        sender_amount_sq_sum: Dict[str, float] = defaultdict(float)
        sender_night_count: Dict[str, int] = defaultdict(int)
        sender_last_step: Dict[str, int] = {}

        out_rows: list[dict[str, float | int]] = []

        for _, row in frame.iterrows():
            sender = str(row["sender_id"])
            receiver = str(row["receiver_id"])
            step = int(row["step"])
            amount = float(row["amount"])
            device = str(row["device_id"])
            geo = str(row["geo_bucket"])
            hour = int(row["hour"]) if "hour" in frame.columns else int(step % 24)

            s_short = sender_short_window[sender]
            s_long = sender_long_window[sender]
            s_long_recv = sender_long_receivers[sender]
            r_long = receiver_long_window[receiver]
            s_recent = sender_recent_steps[sender]

            _prune(s_short, step, self.config.short_window)
            _prune(s_long, step, self.config.long_window)
            _prune(r_long, step, self.config.long_window)
            while s_long_recv and s_long_recv[0][0] < step - self.config.long_window:
                s_long_recv.popleft()
            while s_recent and s_recent[0] < step - self.config.burst_window:
                s_recent.popleft()

            sender_txn_count_last_5 = len(s_short)
            sender_txn_count_last_24 = len(s_long)
            sender_amount_sum_last_24 = float(sum(v for _, v in s_long))
            receiver_incoming_count_last_24 = len(r_long)

            is_new_receiver_for_sender = int(receiver not in sender_seen_receivers[sender])
            receiver_seen_count = int(receiver_total_seen[receiver])
            device_new_for_sender = int(device not in sender_seen_devices[sender])
            geo_new_for_sender = int(geo not in sender_seen_geos[sender])

            prev_count = sender_count[sender]
            prev_sum = sender_amount_sum[sender]
            prev_sq_sum = sender_amount_sq_sum[sender]
            sender_avg = prev_sum / prev_count if prev_count > 0 else amount
            sender_var = max((prev_sq_sum / prev_count) - (sender_avg**2), 1e-6) if prev_count > 1 else max(amount * 0.1, 1.0)
            sender_std = float(np.sqrt(sender_var))

            amount_vs_sender_avg = float(amount / max(sender_avg, 1.0))
            sender_amount_zscore = float((amount - sender_avg) / max(sender_std, 1e-6))
            sender_night_txn_ratio = float(sender_night_count[sender] / max(prev_count, 1))
            burst_density_score = float(len(s_recent) / max(self.config.burst_window, 1))
            time_since_last_sender_txn = float(step - sender_last_step[sender]) if sender in sender_last_step else float(self.config.long_window + 1)

            sender_out_degree = float(len(sender_neighbors[sender]))
            receiver_in_degree = float(len(receiver_sources[receiver]))
            unique_recent_receivers = len({dst for _, dst in s_long_recv})
            fanout_score = float(unique_recent_receivers / max(sender_txn_count_last_24, 1))
            mule_cluster_score = float((receiver_in_degree * (receiver_incoming_count_last_24 + 1)) / 10.0)
            repeated_cashout_score = float(receiver_cashout_counter[receiver] / max(receiver_seen_count, 1))

            suspicious_round_amount = int((amount % 100) < 2.0 or (amount % 500) < 2.5)
            old_bal = float(row["oldbalanceOrg"]) if "oldbalanceOrg" in frame.columns else 0.0
            new_bal = float(row["newbalanceOrig"]) if "newbalanceOrig" in frame.columns else 0.0
            drain_ratio = (old_bal - new_bal) / max(old_bal, 1.0)
            partial_balance_drain = int(0.40 <= drain_ratio <= 0.95 and new_bal > 0.0)
            rapid_sequential_transfer = int(time_since_last_sender_txn <= 1.0)
            high_velocity_new_receiver = int(is_new_receiver_for_sender == 1 and sender_txn_count_last_5 >= 3)

            out_rows.append(
                {
                    "sender_txn_count_last_5_steps": sender_txn_count_last_5,
                    "sender_txn_count_last_24_steps": sender_txn_count_last_24,
                    "sender_amount_sum_last_24_steps": sender_amount_sum_last_24,
                    "receiver_incoming_count_last_24_steps": receiver_incoming_count_last_24,
                    "is_new_receiver_for_sender": is_new_receiver_for_sender,
                    "receiver_seen_count": receiver_seen_count,
                    "device_new_for_sender": device_new_for_sender,
                    "geo_new_for_sender": geo_new_for_sender,
                    "amount_vs_sender_avg": amount_vs_sender_avg,
                    "sender_amount_zscore": sender_amount_zscore,
                    "sender_night_txn_ratio": sender_night_txn_ratio,
                    "burst_density_score": burst_density_score,
                    "time_since_last_sender_txn": time_since_last_sender_txn,
                    "sender_out_degree": sender_out_degree,
                    "receiver_in_degree": receiver_in_degree,
                    "fanout_score": fanout_score,
                    "mule_cluster_score": mule_cluster_score,
                    "repeated_cashout_score": repeated_cashout_score,
                    "suspicious_round_amount": suspicious_round_amount,
                    "partial_balance_drain": partial_balance_drain,
                    "rapid_sequential_transfer": rapid_sequential_transfer,
                    "high_velocity_new_receiver": high_velocity_new_receiver,
                }
            )

            # State update must happen after feature extraction.
            s_short.append((step, amount))
            s_long.append((step, amount))
            s_long_recv.append((step, receiver))
            r_long.append((step, amount))
            s_recent.append(step)

            sender_seen_receivers[sender].add(receiver)
            sender_seen_devices[sender].add(device)
            sender_seen_geos[sender].add(geo)

            sender_neighbors[sender].add(receiver)
            receiver_sources[receiver].add(sender)
            receiver_total_seen[receiver] += 1

            tx_type = str(row["type"]) if "type" in frame.columns else "TRANSFER"
            if tx_type == "CASH_OUT":
                receiver_cashout_counter[sender] += 1

            sender_count[sender] += 1
            sender_amount_sum[sender] += amount
            sender_amount_sq_sum[sender] += amount**2
            if hour in {22, 23, 0, 1, 2, 3, 4}:
                sender_night_count[sender] += 1
            sender_last_step[sender] = step

        features_df = pd.DataFrame(out_rows)
        output = pd.concat([frame.drop(columns=["index"]), features_df], axis=1)
        return output


def build_feature_store(df: pd.DataFrame, config: FeatureStoreConfig = FeatureStoreConfig()) -> pd.DataFrame:
    """Functional API for building Feature Store V2."""
    return FeatureStoreV2(config=config).build_feature_store(df)
