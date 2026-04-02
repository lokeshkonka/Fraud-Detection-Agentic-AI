from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd


@dataclass
class SimulationConfig:
    """Configuration for behavioral fraud simulation."""

    n_rows: int = 120_000
    fraud_ratio: float = 0.08
    n_accounts: int = 6_000
    n_devices: int = 3_500
    n_ip_clusters: int = 240
    n_geo_buckets: int = 90
    max_step: int = 1_440
    seed: int = 42


class FraudSimulatorV2:
    """Behavioral fraud simulator with overlapping fraud/legit distributions.

    Fraud archetypes:
    - account_takeover
    - mule_network
    - smurfing
    - layering
    """

    def __init__(self, config: SimulationConfig = SimulationConfig()) -> None:
        self.config = config
        self.rng = np.random.default_rng(config.seed)

        self.accounts = [f"acct_{i:05d}" for i in range(config.n_accounts)]
        self.devices = [f"dev_{i:05d}" for i in range(config.n_devices)]
        self.ip_clusters = [f"ip_{i:03d}" for i in range(config.n_ip_clusters)]
        self.geo_buckets = [f"geo_{i:03d}" for i in range(config.n_geo_buckets)]

        self.account_balance: Dict[str, float] = {
            acct: float(self.rng.lognormal(mean=8.0, sigma=0.55)) for acct in self.accounts
        }
        self.sender_profile: Dict[str, Dict[str, object]] = {
            acct: {
                "avg_amount": float(self.rng.lognormal(mean=5.5, sigma=0.65)),
                "std_amount": float(self.rng.lognormal(mean=4.6, sigma=0.45)),
                "fav_devices": list(self.rng.choice(self.devices, size=2, replace=False)),
                "fav_ips": list(self.rng.choice(self.ip_clusters, size=2, replace=False)),
                "fav_geos": list(self.rng.choice(self.geo_buckets, size=2, replace=False)),
                "known_receivers": set(self.rng.choice(self.accounts, size=5, replace=False).tolist()),
            }
            for acct in self.accounts
        }
        self.global_mule_pool: List[str] = []

    def _random_step_path(self, count: int, start_low: int = 1, start_high: int | None = None) -> np.ndarray:
        end = start_high if start_high is not None else self.config.max_step
        base = int(self.rng.integers(start_low, max(start_low + 1, end - 10)))
        offsets = self.rng.integers(0, 7, size=count)
        return np.sort(base + offsets)

    def _pick_sender(self) -> str:
        return str(self.rng.choice(self.accounts))

    def _pick_receiver(self, sender: str, force_new: bool = False) -> Tuple[str, int]:
        profile = self.sender_profile[sender]
        known = profile["known_receivers"]
        if force_new or (self.rng.random() < 0.24):
            receiver = str(self.rng.choice(self.accounts))
            if receiver == sender:
                receiver = str(self.rng.choice(self.accounts))
            is_new = int(receiver not in known)
            known.add(receiver)
            return receiver, is_new

        if known:
            receiver = str(self.rng.choice(list(known)))
            return receiver, 0

        receiver = str(self.rng.choice(self.accounts))
        known.add(receiver)
        return receiver, 1

    def _pick_device_ip_geo(self, sender: str, suspicious: bool = False) -> Tuple[str, str, str]:
        profile = self.sender_profile[sender]
        if suspicious:
            if self.rng.random() < 0.72:
                dev = str(self.rng.choice(self.devices))
            else:
                dev = str(self.rng.choice(profile["fav_devices"]))

            if self.rng.random() < 0.58:
                ip = str(self.rng.choice(self.ip_clusters))
                geo = str(self.rng.choice(self.geo_buckets))
            else:
                ip = str(self.rng.choice(profile["fav_ips"]))
                geo = str(self.rng.choice(profile["fav_geos"]))
            return dev, ip, geo

        dev = str(self.rng.choice(profile["fav_devices"])) if self.rng.random() < 0.78 else str(self.rng.choice(self.devices))
        ip = str(self.rng.choice(profile["fav_ips"])) if self.rng.random() < 0.80 else str(self.rng.choice(self.ip_clusters))
        geo = str(self.rng.choice(profile["fav_geos"])) if self.rng.random() < 0.80 else str(self.rng.choice(self.geo_buckets))
        return dev, ip, geo

    def _bounded_amount(self, sender: str, multiplier: float, floor: float = 5.0) -> float:
        profile = self.sender_profile[sender]
        amount = profile["avg_amount"] * multiplier + self.rng.normal(0, profile["std_amount"] * 0.15)
        balance = self.account_balance.get(sender, 1000.0)
        cap = max(floor + 1.0, 0.92 * balance)
        return float(np.clip(amount, floor, cap))

    def _txn_type(self, fraud_archetype: str) -> str:
        if fraud_archetype == "mule_network":
            return str(self.rng.choice(["TRANSFER", "TRANSFER", "CASH_OUT"], p=[0.65, 0.25, 0.10]))
        if fraud_archetype == "layering":
            return str(self.rng.choice(["TRANSFER", "CASH_OUT"], p=[0.85, 0.15]))
        if fraud_archetype == "smurfing":
            return "TRANSFER"
        if fraud_archetype == "account_takeover":
            return str(self.rng.choice(["TRANSFER", "CASH_OUT"], p=[0.80, 0.20]))
        return str(self.rng.choice(["PAYMENT", "TRANSFER", "DEBIT", "CASH_OUT"], p=[0.52, 0.25, 0.08, 0.15]))

    def _make_transaction(
        self,
        step: int,
        sender: str,
        receiver: str,
        amount: float,
        is_fraud: int,
        archetype: str,
        force_suspicious_ctx: bool,
        is_new_beneficiary: int,
    ) -> Dict[str, object]:
        device, ip_cluster, geo_bucket = self._pick_device_ip_geo(sender, suspicious=force_suspicious_ctx)

        oldbalance_org = float(max(5.0, self.account_balance.get(sender, 500.0)))
        oldbalance_dest = float(max(0.0, self.account_balance.get(receiver, 200.0)))

        if is_fraud:
            debit_factor = float(self.rng.uniform(0.90, 1.02))
            credit_factor = float(self.rng.uniform(0.85, 1.07))
        else:
            debit_factor = float(self.rng.uniform(0.92, 1.00))
            credit_factor = float(self.rng.uniform(0.88, 1.02))

        effective_amount = float(min(amount, 0.95 * oldbalance_org))
        newbalance_orig = float(max(0.0, oldbalance_org - effective_amount * debit_factor))
        newbalance_dest = float(max(0.0, oldbalance_dest + effective_amount * credit_factor))

        self.account_balance[sender] = newbalance_orig + float(self.rng.uniform(0.0, 12.0))
        self.account_balance[receiver] = newbalance_dest

        txn_type = self._txn_type(archetype)
        tx_id = "txn_" + "".join(self.rng.choice(list("abcdefghijklmnopqrstuvwxyz0123456789"), size=12))

        return {
            "transaction_id": tx_id,
            "step": int(step),
            "hour": int(step % 24),
            "type": txn_type,
            "sender_id": sender,
            "receiver_id": receiver,
            "device_id": device,
            "ip_cluster": ip_cluster,
            "geo_bucket": geo_bucket,
            "amount": round(float(effective_amount), 2),
            "oldbalanceOrg": round(oldbalance_org, 2),
            "newbalanceOrig": round(newbalance_orig, 2),
            "oldbalanceDest": round(oldbalance_dest, 2),
            "newbalanceDest": round(newbalance_dest, 2),
            "is_new_beneficiary": int(is_new_beneficiary),
            "is_fraud": int(is_fraud),
            "fraud_archetype": archetype,
        }

    def _generate_legit(self, n_rows: int) -> List[Dict[str, object]]:
        events: List[Dict[str, object]] = []
        steps = np.sort(self.rng.integers(1, self.config.max_step + 1, size=n_rows))
        for step in steps:
            sender = self._pick_sender()
            receiver, is_new = self._pick_receiver(sender, force_new=False)
            hour = int(step % 24)
            base_multiplier = float(self.rng.uniform(0.55, 1.45))
            if hour in {22, 23, 0, 1, 2, 3, 4} and self.rng.random() < 0.12:
                base_multiplier *= 1.35
            amount = self._bounded_amount(sender, multiplier=base_multiplier)
            events.append(
                self._make_transaction(
                    step=int(step),
                    sender=sender,
                    receiver=receiver,
                    amount=amount,
                    is_fraud=0,
                    archetype="legit",
                    force_suspicious_ctx=False,
                    is_new_beneficiary=is_new,
                )
            )
        return events

    def _generate_account_takeover(self, n_rows: int) -> List[Dict[str, object]]:
        events: List[Dict[str, object]] = []
        while len(events) < n_rows:
            sender = self._pick_sender()
            burst = int(self.rng.integers(3, 7))
            steps = self._random_step_path(burst, start_low=1, start_high=self.config.max_step)
            for step in steps:
                if len(events) >= n_rows:
                    break
                receiver, is_new = self._pick_receiver(sender, force_new=True)
                hour = int(step % 24)
                if hour not in {0, 1, 2, 3, 4, 23}:
                    step = int(min(self.config.max_step, step + self.rng.integers(15, 30)))
                multiplier = float(self.rng.uniform(1.4, 3.4))
                amount = self._bounded_amount(sender, multiplier=multiplier)
                if self.rng.random() < 0.35:
                    amount = min(amount, self.account_balance.get(sender, 0.0) * float(self.rng.uniform(0.45, 0.78)))
                events.append(
                    self._make_transaction(
                        step=int(step),
                        sender=sender,
                        receiver=receiver,
                        amount=amount,
                        is_fraud=1,
                        archetype="account_takeover",
                        force_suspicious_ctx=True,
                        is_new_beneficiary=is_new,
                    )
                )
        return events

    def _generate_mule_network(self, n_rows: int) -> List[Dict[str, object]]:
        events: List[Dict[str, object]] = []
        while len(events) < n_rows:
            source = self._pick_sender()
            fanout_size = int(self.rng.integers(3, 6))
            burst_steps = self._random_step_path(fanout_size, start_low=1, start_high=self.config.max_step)

            if self.global_mule_pool and self.rng.random() < 0.55:
                destinations = list(self.rng.choice(self.global_mule_pool, size=fanout_size, replace=True))
            else:
                destinations = [str(self.rng.choice(self.accounts)) for _ in range(fanout_size)]
                self.global_mule_pool.extend(destinations[: max(1, fanout_size // 2)])

            for idx, (step, dest) in enumerate(zip(burst_steps, destinations)):
                if len(events) >= n_rows:
                    break
                amount = self._bounded_amount(source, multiplier=float(self.rng.uniform(0.95, 2.10)))
                events.append(
                    self._make_transaction(
                        step=int(step),
                        sender=source,
                        receiver=dest,
                        amount=amount,
                        is_fraud=1,
                        archetype="mule_network",
                        force_suspicious_ctx=True,
                        is_new_beneficiary=1,
                    )
                )

                if len(events) >= n_rows:
                    break
                if self.rng.random() < 0.78:
                    sink = str(self.rng.choice(self.accounts))
                    cashout_amt = amount * float(self.rng.uniform(0.62, 0.94))
                    events.append(
                        self._make_transaction(
                            step=int(min(self.config.max_step, step + idx + 1)),
                            sender=dest,
                            receiver=sink,
                            amount=cashout_amt,
                            is_fraud=1,
                            archetype="mule_network",
                            force_suspicious_ctx=True,
                            is_new_beneficiary=1,
                        )
                    )
        return events[:n_rows]

    def _generate_smurfing(self, n_rows: int) -> List[Dict[str, object]]:
        events: List[Dict[str, object]] = []
        while len(events) < n_rows:
            sender = self._pick_sender()
            chain = int(self.rng.integers(4, 9))
            steps = self._random_step_path(chain, start_low=1, start_high=self.config.max_step)
            threshold = float(self.rng.choice([750.0, 900.0, 1000.0, 1200.0]))
            for step in steps:
                if len(events) >= n_rows:
                    break
                receiver, is_new = self._pick_receiver(sender, force_new=self.rng.random() < 0.45)
                amount = float(self.rng.uniform(threshold * 0.72, threshold * 0.98))
                amount = min(amount, self.account_balance.get(sender, amount + 50.0) * 0.55)
                events.append(
                    self._make_transaction(
                        step=int(step),
                        sender=sender,
                        receiver=receiver,
                        amount=amount,
                        is_fraud=1,
                        archetype="smurfing",
                        force_suspicious_ctx=False,
                        is_new_beneficiary=is_new,
                    )
                )
        return events

    def _generate_layering(self, n_rows: int) -> List[Dict[str, object]]:
        events: List[Dict[str, object]] = []
        while len(events) < n_rows:
            origin = self._pick_sender()
            hop1 = [str(self.rng.choice(self.accounts)) for _ in range(2)]
            hop2 = [str(self.rng.choice(self.accounts)) for _ in range(2)]
            cluster_sink = str(self.rng.choice(self.accounts))

            start = int(self.rng.integers(1, self.config.max_step - 10))
            total = self._bounded_amount(origin, multiplier=float(self.rng.uniform(1.10, 2.40)))
            chunks = self.rng.dirichlet(np.array([1.4, 1.6])) * total

            path = [
                (start, origin, hop1[0], chunks[0] * 0.95),
                (start + 1, origin, hop1[1], chunks[1] * 0.97),
                (start + 2, hop1[0], hop2[0], chunks[0] * 0.84),
                (start + 3, hop1[1], hop2[1], chunks[1] * 0.82),
                (start + 4, hop2[0], cluster_sink, chunks[0] * 0.76),
                (start + 5, hop2[1], cluster_sink, chunks[1] * 0.74),
            ]

            for step, sender, receiver, amount in path:
                if len(events) >= n_rows:
                    break
                events.append(
                    self._make_transaction(
                        step=int(min(self.config.max_step, step)),
                        sender=sender,
                        receiver=receiver,
                        amount=float(amount),
                        is_fraud=1,
                        archetype="layering",
                        force_suspicious_ctx=True,
                        is_new_beneficiary=1,
                    )
                )
        return events[:n_rows]

    def generate(self) -> pd.DataFrame:
        """Generate synthetic transactions with overlapping legit/fraud distributions."""
        n_fraud = int(self.config.n_rows * self.config.fraud_ratio)
        n_legit = self.config.n_rows - n_fraud

        legit_events = self._generate_legit(n_legit)

        fraud_alloc = {
            "account_takeover": int(n_fraud * 0.32),
            "mule_network": int(n_fraud * 0.27),
            "smurfing": int(n_fraud * 0.21),
        }
        fraud_alloc["layering"] = n_fraud - sum(fraud_alloc.values())

        fraud_events: List[Dict[str, object]] = []
        fraud_events.extend(self._generate_account_takeover(fraud_alloc["account_takeover"]))
        fraud_events.extend(self._generate_mule_network(fraud_alloc["mule_network"]))
        fraud_events.extend(self._generate_smurfing(fraud_alloc["smurfing"]))
        fraud_events.extend(self._generate_layering(fraud_alloc["layering"]))

        df = pd.DataFrame(legit_events + fraud_events)
        df = df.sort_values(["step", "transaction_id"]).reset_index(drop=True)

        # Add mild natural overlap so no trivial balance-based shortcuts dominate.
        jitter = self.rng.normal(0, df["amount"].std() * 0.015, size=len(df))
        df["amount"] = np.clip(df["amount"] + jitter, a_min=1.0, a_max=None).round(2)
        df["partial_drain_ratio"] = (
            (df["oldbalanceOrg"] - df["newbalanceOrig"]) / (df["oldbalanceOrg"].replace(0, np.nan))
        ).fillna(0.0)

        return df


def generate_behavioral_dataset(config: SimulationConfig = SimulationConfig()) -> pd.DataFrame:
    """Convenience function for one-shot generation."""
    return FraudSimulatorV2(config=config).generate()
