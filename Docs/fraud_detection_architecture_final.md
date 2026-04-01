# fraud_detection_architecture_final.md

## New Layer 4.7 --- Scheduled ModelOps

Every **7 days** - fetch latest 7-day labels - run drift checks -
retrain XGBoost + GNN - validate AUC-PR - compare challenger - shadow
deploy - allow promote

## UI Mapping

Layer 4.7 → `/model-ops`
