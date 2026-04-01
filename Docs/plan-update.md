# plan-update.md --- ML Training + EDA Integration Upgrade Master Plan

## 🎯 Objective

Upgrade the entire fraud ML pipeline by integrating: - cumulative
accuracy tracking graph - dataset distribution histograms - variance +
mean statistics - boxplot outlier analysis - metafeature distributions -
model benchmarking feedback loop - notebook updates - UI `/model-lab`
integration - scheduled retraining diagnostics

This plan is designed to be handed directly to an **AI coding agent**.

------------------------------------------------------------------------

# 📊 New analysis assets to integrate

Generated artifacts now available: - `accuracy_graph.png` -
`dataset_analysis_graphs.png` - `dataset_boxplots.png` - `analysis.py`

Source analysis script: `notebooks/train_pipeline.py`

These must become part of: 1. training workflow 2. model selection 3.
drift baseline 4. UI explainability 5. weekly retraining

------------------------------------------------------------------------

# 📁 Files that MUST be updated

## 1) `01_dataset_prep_local_full.ipynb`

## Changes

-   add EDA section after dataframe creation
-   compute mean / variance tables
-   generate histograms for top 8 numerical features
-   generate boxplots for outlier-heavy columns
-   export:

``` txt
artifacts/eda/
├── dataset_analysis_graphs.png
├── dataset_boxplots.png
└── feature_stats.csv
```

## Why

This improves: - fraud feature realism - skew validation - synthetic vs
PaySim alignment - outlier understanding

------------------------------------------------------------------------

## 2) `02_xgb_regression_rf_training.ipynb`

## Changes

Add **accuracy-over-transactions tracking** for: - XGB - Logistic
Regression - Random Forest

Generate:

``` txt
artifacts/model_eval/
├── xgb_accuracy_curve.png
├── rf_accuracy_curve.png
└── lr_accuracy_curve.png
```

Track: - cumulative precision - cumulative recall - cumulative fraud
catch % - false positive trend

------------------------------------------------------------------------

## 3) `03_model_comparison_and_thresholds.ipynb`

## Changes

Add: - compare EDA-informed feature subsets - compare raw vs clipped
outliers - compare log-scaled amount features - compare balance delta
engineered features

### New feature engineering

``` python
balance_delta_org = oldbalanceOrg - newbalanceOrig
balance_delta_dest = newbalanceDest - oldbalanceDest
amount_log = log1p(amount)
```

This should be benchmarked across all 3 models.

------------------------------------------------------------------------

## 4) `04_shap_and_feature_importance.ipynb`

## Changes

SHAP should now explicitly include: - boxplot outlier features -
skew-heavy features - metafeature predictions - fraud ring scores

### Add section

**"SHAP vs statistical skew alignment"** This helps judges trust
explainability.

------------------------------------------------------------------------

## 5) `05_weekly_retrain_and_drift.ipynb` (PLANNED - create if missing)

## Add drift baselines from EDA

Store: - feature means - variances - whisker bounds - outlier ratio -
fraud prevalence

Compare latest 7-day data against these baselines.

------------------------------------------------------------------------

## 6) `06_graph_risk_and_mule_detection.ipynb` (PLANNED - create if missing)

## Add graph-stat EDA

Track: - node degree distribution - cluster size histogram - mule ring
boxplot - suspicious path length distribution

These should feed `/graph-intelligence`.

------------------------------------------------------------------------

# 🧠 Model training logic updates

## Feature engineering upgrades

Mandatory new features: - `amount_log` - `balance_delta_org` -
`balance_delta_dest` - `outlier_flag_amount` - `outlier_flag_balance` -
`variance_bucket` - `mean_shift_score`

These features come directly from your EDA findings.

------------------------------------------------------------------------

# 🎨 UI files to update

## `/model-lab`

Add panels: - Dataset distribution charts - Boxplot anomaly view -
Feature skew heatmap - Model cumulative accuracy graph

## `/model-ops`

Add: - retrain drift against EDA baseline - mean shift alerts - variance
explosion alerts

------------------------------------------------------------------------

# 🐳 Docker / backend updates

## `ml-inference`

Expose:

``` txt
/feature-stats
/model-accuracy-curve
/drift-baseline
```

## `ml-retrain-scheduler`

Before retraining: 1. run EDA baseline compare 2. log variance shifts 3.
detect distribution drift 4. trigger challenger only if drift \>
threshold

------------------------------------------------------------------------

# ✅ AI execution order

1.  patch notebook 01 with EDA
2.  patch notebook 02 with cumulative curves
3.  patch notebook 03 feature engineering
4.  patch notebook 04 SHAP alignment
5.  update notebook 05 drift baselines
6.  update notebook 06 graph EDA
7.  patch model-lab UI
8.  patch retrain scheduler
9.  export new artifacts
10. update Docker image

------------------------------------------------------------------------

# 🏆 Definition of done

Upgrade is complete when: - EDA artifacts auto-generate - all 6
notebooks consume them - model-lab renders them - retrain compares
against them - cumulative accuracy visible - outlier features improve
PR-AUC - drift alerts use variance shifts
