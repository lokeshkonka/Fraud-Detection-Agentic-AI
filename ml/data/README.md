# ML Data — Sample Transactions

## Schema

| Column          | Type    | Description                                              |
|-----------------|---------|----------------------------------------------------------|
| `step`          | int     | Hour within a 31-day simulation window (1–744, PaySim-style) |
| `type`          | str     | Transaction type: PAYMENT, TRANSFER, CASH_OUT, DEBIT     |
| `amount`        | float   | Transaction amount in INR (gamma-distributed, mean ≈ ₹400) |
| `oldbalanceOrg` | float   | Sender's account balance before the transaction          |
| `newbalanceOrig`| float   | Sender's account balance after the transaction           |
| `oldbalanceDest`| float   | Receiver's account balance before the transaction        |
| `newbalanceDest`| float   | Receiver's account balance after the transaction         |
| `is_fraud`      | int     | Binary target: 1 = fraud, 0 = legitimate                 |

## File

`sample_transactions.csv` — 500 rows, ~1% fraud prevalence (3 fraud rows).  
Fraud rows have realistic patterns: large amounts, sender balance drained to 0,
transaction type TRANSFER or CASH_OUT (consistent with real PaySim fraud archetypes).

## Full dataset

The training pipeline (`ml/training/pipeline.py`) synthesises **250,000 rows** at
**1% fraud prevalence** when no real dataset is found at
`data/processed/transactions.parquet`.

To supply a real dataset:
```
export FRAUD_DATA_PATH=/path/to/your/transactions.parquet
python -m ml.training.pipeline
```

The pipeline also accepts CSV files (auto-detected by extension).

## Data realism

| Property                   | Implementation                                              |
|----------------------------|-------------------------------------------------------------|
| Amount distribution        | Gamma(shape=2, scale=200) — right-skewed, heavy tail        |
| Origin balance             | Normal(μ=5000, σ=1500) — realistic retail account sizes     |
| Destination balance        | Normal(μ=2000, σ=1000)                                      |
| Fraud prevalence           | 1% — consistent with PaySim and real banking datasets       |
| Fraud pattern — TRANSFER   | Large amount, balance drained to 0 in origin account        |
| Fraud pattern — CASH_OUT   | Large amount, immediate cash-out, new destination account   |
| Class imbalance            | 99:1 (negative:positive) — bank-production realistic        |

## Why 250k rows?

- **Statistical reliability**: 250k × 1% = 2,500 fraud cases → enough to train
  a robust minority-class classifier and produce stable PR-AUC estimates.
- **Variance reduction**: < 50k rows causes high variance in precision@top1%
  across seeds, making hyperparameter comparison unreliable.
- **Memory efficiency**: 250k rows with 15 features fits comfortably in RAM
  without requiring distributed training infrastructure.
- **PaySim alignment**: The original Kaggle PaySim dataset has ~6.3M rows at
  0.13% fraud. At 250k rows and 1%, we get a comparable absolute fraud count
  (2,500 vs ~8,000) while keeping the simulation fast.

## Why 1% fraud?

- **Bank realism**: Real-world online banking fraud rates range from 0.1% to 2%
  depending on channel and geography. 1% is a defensible mid-point.
- **Training signal**: At 0.1%, even 250k rows gives only ~250 fraud cases —
  too few for tree-based models to learn reliable split thresholds.
- **Stress-testable**: The pipeline supports `FRAUD_RATIO=0.001` to simulate
  0.1% prevalence and observe model degradation.
