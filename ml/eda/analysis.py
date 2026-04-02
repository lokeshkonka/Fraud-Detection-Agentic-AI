"""
EDA (Exploratory Data Analysis) module.

Responsibilities
----------------
- Compute and persist feature statistics (mean, variance)
- Save histogram and boxplot images to artifacts/eda/
- Build the sklearn ColumnTransformer preprocessor used by all models

Outputs
-------
artifacts/eda/feature_stats.csv         — per-feature mean + variance
artifacts/eda/dataset_analysis_graphs.png — histograms for top-8 numeric features
artifacts/eda/dataset_boxplots.png       — boxplots for top-8 numeric features
"""
from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

plt.style.use("dark_background")
sns.set_theme(style="darkgrid")


def save_eda(df: pd.DataFrame, artifact_dir: Path) -> None:
    """
    Compute feature stats and save EDA plots.

    Parameters
    ----------
    df          : feature-engineered DataFrame (target column is_fraud present)
    artifact_dir: directory where EDA artifacts are written
    """
    artifact_dir.mkdir(parents=True, exist_ok=True)
    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c]) and c != "is_fraud"]

    # --- feature stats CSV ---
    summary = df[numeric_cols].agg(["mean", "var"]).T.rename(columns={"var": "variance"})
    stats_path = artifact_dir / "feature_stats.csv"
    summary.to_csv(stats_path)
    print(f"Saved feature stats → {stats_path}")

    num_for_hist = numeric_cols[:8]
    n_cols = max(1, int(np.ceil(len(num_for_hist) / 2)))

    # --- histograms ---
    fig, axes = plt.subplots(2, n_cols, figsize=(16, 8))
    axes = axes.flatten()
    for ax, col in zip(axes, num_for_hist):
        sns.histplot(df[col], bins=40, kde=False, ax=ax)
        ax.set_title(f"Histogram: {col}")
    plt.tight_layout()
    hist_path = artifact_dir / "dataset_analysis_graphs.png"
    fig.savefig(hist_path)
    plt.close(fig)
    print(f"Saved histograms → {hist_path}")

    # --- boxplots ---
    fig, axes = plt.subplots(2, n_cols, figsize=(16, 8))
    axes = axes.flatten()
    for ax, col in zip(axes, num_for_hist):
        sns.boxplot(x=df[col], ax=ax, orient="h")
        ax.set_title(f"Boxplot: {col}")
    plt.tight_layout()
    box_path = artifact_dir / "dataset_boxplots.png"
    fig.savefig(box_path)
    plt.close(fig)
    print(f"Saved boxplots → {box_path}")


def build_preprocessor(cat_cols: list[str], num_cols: list[str]) -> ColumnTransformer:
    """
    Return a sklearn ColumnTransformer that:
    - Standardises numeric columns with StandardScaler
    - One-hot encodes categorical columns (unknown categories ignored at inference)

    Parameters
    ----------
    cat_cols : list of categorical column names
    num_cols : list of numeric column names

    Returns
    -------
    sklearn.compose.ColumnTransformer (unfitted)
    """
    numeric_transformer = Pipeline([("scaler", StandardScaler())])
    categorical_transformer = Pipeline([("encoder", OneHotEncoder(handle_unknown="ignore"))])
    return ColumnTransformer(
        transformers=[
            ("num", numeric_transformer, num_cols),
            ("cat", categorical_transformer, cat_cols),
        ]
    )
