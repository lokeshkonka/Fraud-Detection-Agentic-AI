# plan.md --- Google Colab GPU Training Workflow

## 🎯 Objective

Train the fraud detection stack using **Google Colab GPU from VS
Code/Codespaces** for heavy ML tasks: - XGBoost champion - LightGBM
challenger - GraphSAGE GNN - SHAP batch explanations - weekly retrain
notebook - artifact export back to repo

------------------------------------------------------------------------

# ☁️ Phase 1 --- Notebook setup in repo

Create this folder:

``` txt
notebooks/
├── 01_dataset_prep.ipynb
├── 02_xgb_training.ipynb
├── 03_gnn_training.ipynb
├── 04_shap_explainer.ipynb
└── 05_weekly_retrain.ipynb
```

Open in VS Code → **Select Kernel → Google Colab → GPU**

Verify:

``` python
import torch
print(torch.cuda.is_available())
!nvidia-smi
```

------------------------------------------------------------------------

# 📦 Phase 2 --- Dataset prep (CPU or GPU optional)

Input files:

``` txt
data/synthetic/
├── fraud_dataset_200k.parquet
├── train.csv
├── val.csv
└── test.csv
```

Tasks: - load parquet - encode categoricals - normalize graph features -
split node/edge features - persist tensors for GNN

Output:

``` txt
data/processed/
├── x_train.parquet
├── x_val.parquet
├── x_test.parquet
├── graph_edges.pt
└── node_features.pt
```

------------------------------------------------------------------------

# 🌲 Phase 3 --- XGBoost training

Notebook: `02_xgb_training.ipynb`

Use GPU:

``` python
import xgboost as xgb
model = xgb.XGBClassifier(
    tree_method="hist",
    device="cuda",
    max_depth=6,
    n_estimators=500
)
```

Export:

``` txt
models/xgb_fraud_v1.json
```

Track: - AUC PR - Recall - Precision - threshold 0.42 baseline

------------------------------------------------------------------------

# 🕸️ Phase 4 --- GNN GPU training

Notebook: `03_gnn_training.ipynb`

Use: - PyTorch Geometric - GraphSAGE - GPU batch loaders - neighbor
sampling

Target: - mule ring recall 90%+ - node ROC 0.95

Export:

``` txt
models/gnn_fraud_v1.pt
```

------------------------------------------------------------------------

# 🔍 Phase 5 --- SHAP GPU batch cache

Notebook: `04_shap_explainer.ipynb`

Tasks: - sample top fraud cases - generate SHAP waterfall caches - save
JSON explanations for dashboard - persist top feature rankings

Output:

``` txt
models/shap_cache/
```

------------------------------------------------------------------------

# 🔁 Phase 6 --- Weekly retrain notebook

Notebook: `05_weekly_retrain.ipynb`

Every 7 days: 1. load latest fraud labels 2. include false positives 3.
include Layer 4.5 clusters 4. retrain XGB + GNN 5. compare challenger 6.
export report

Promotion rules: - AUC PR +1% - FPR \<= champion - PSI \< 0.1

------------------------------------------------------------------------

# 📤 Phase 7 --- Push artifacts back to repo

Commit:

``` txt
models/
├── xgb_fraud_v1.json
├── gnn_fraud_v1.pt
├── shap.pkl
├── thresholds.json
└── retrain_report.md
```

------------------------------------------------------------------------

# ✅ Best execution order

1.  dataset prep
2.  XGBoost GPU
3.  GNN GPU
4.  SHAP cache
5.  weekly retrain
6.  commit models
7.  docker rebuild inference service
