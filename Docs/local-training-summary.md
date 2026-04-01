# Local Training Flow Summary (venv, no Colab)

Date: 2026-04-01

## 1) Flow validation result

- Notebook naming is now local-first: `notebooks/01_dataset_prep_local_full.ipynb`.
- Unified training script exists: `notebooks/train_pipeline.py`.
- Local dependency lock file added: `notebooks/requirements-local-train.txt`.
- Main repo runbook now includes venv-first training steps in `README.md`.
- Service naming in docs aligned to repository (`api-gateway`, `ml-inference`, etc.).

## 2) Current artifact status

Generated and present:
- `artifacts/eda/dataset_analysis_graphs.png`
- `artifacts/eda/dataset_boxplots.png`
- `artifacts/eda/feature_stats.csv`
- `artifacts/model_eval/lr_accuracy_curve.png`
- `artifacts/model_eval/rf_accuracy_curve.png`
- `artifacts/model_eval/xgb_accuracy_curve.png`
- `artifacts/model_eval/model_eval_summary.csv`
- `artifacts/model_eval/model_variant_comparison.csv`
- `artifacts/model_eval/thresholds.json`
- `artifacts/model_eval/top3_pr_curves.png`
- `artifacts/model_eval/top3_roc_curves.png`
- `artifacts/shap/shap_log_reg_summary.png`
- `artifacts/shap/skew_stats.csv`

Missing and expected from unified run:
- `artifacts/drift/drift_baseline.json`

## 3) Latest model snapshot (from model_eval_summary.csv)

- `xgb`: PR-AUC = 0.0136366775, ROC-AUC = 0.5622021704
- `lr`: PR-AUC = 0.0113456674, ROC-AUC = 0.5245371640
- `rf`: PR-AUC = 0.0110890847, ROC-AUC = 0.5253081162

Top variant/model from `model_variant_comparison.csv`:
- `A_base + xgb`: PR-AUC = 0.0136366775, ROC-AUC = 0.5622021704
- Best PR threshold = 0.030495136976242065
- Best ROC threshold = 0.004973436705768108

## 4) Canonical local training command (must use venv)

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r notebooks/requirements-local-train.txt
python notebooks/train_pipeline.py
```

Optional data path override:

```bash
export FRAUD_DATA_PATH=data/processed/transactions.parquet
```

After run, verify:
- `models/lr.joblib`, `models/rf.joblib`, `models/xgb.joblib` (if xgboost installed)
- `artifacts/drift/drift_baseline.json`

## 5) Session execution note

In this chat session, direct shell/task execution returned a workspace provider error (`ENOPRO`), and notebook cell execution did not persist run state. Because of that tooling limitation, commands were prepared and documented, but a fresh end-to-end venv run could not be completed from the assistant tools in this turn.
