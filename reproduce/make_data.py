"""Step 1: build the three CSVs, the dataset metadata and the provenance manifest.

Writes into <out>/ (normally starter/data/):
  glucose.csv, sbp.csv, fev1.csv   one row per person: row_id, split, features, target
  datasets.json                    labels, units, feature order, categorical groups
  manifest.json                    provenance: raw files and hashes, versions, counts, summaries
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
from sklearn.model_selection import train_test_split

import nhanes

SEED = 0
VALIDATION_SHARE = 0.2

ETH = {
    "eth_Mexican American": ("eth_mexican_american", "Mexican American"),
    "eth_Other Hispanic": ("eth_other_hispanic", "Other Hispanic"),
    "eth_Non-Hispanic Black": ("eth_nh_black", "Non-Hispanic Black"),
    "eth_Non-Hispanic Asian": ("eth_nh_asian", "Non-Hispanic Asian"),
    "eth_Other / multiracial": ("eth_other_multiracial", "Other / multiracial"),
}

# id -> (loader, (target column, label, units), {NHANES column: (csv column, label, units)})
SPEC = {
    "glucose": (
        nhanes.glucose,
        ("fasting_glucose", "Fasting glucose", "mg/dL"),
        {
            "LBXGH": ("hba1c", "HbA1c (3-month average blood sugar)", "%"),
            "RIDAGEYR": ("age", "Age", "years"),
            "BMXBMI": ("bmi", "Body mass index", "kg/m²"),
            "BMXWAIST": ("waist_cm", "Waist circumference", "cm"),
            "female": ("female", "Female (1 = female, 0 = male)", "0/1"),
        },
    ),
    "sbp": (
        nhanes.sbp,
        ("systolic_bp", "Systolic blood pressure (mean of up to 3 readings)", "mmHg"),
        {
            "RIDAGEYR": ("age", "Age", "years"),
            "BMXBMI": ("bmi", "Body mass index", "kg/m²"),
            "BMXWAIST": ("waist_cm", "Waist circumference", "cm"),
            "female": ("female", "Female (1 = female, 0 = male)", "0/1"),
            "INDFMPIR": ("income_poverty_ratio", "Family income ÷ poverty line (capped at 5)", "ratio"),
            **{k: (c, f"Race/ethnicity: {lab} (vs Non-Hispanic White)", "0/1") for k, (c, lab) in ETH.items()},
        },
    ),
    "fev1": (
        nhanes.fev1,
        ("fev1", "FEV₁: air blown out in the first second", "mL"),
        {
            "RIDAGEYR": ("age", "Age", "years"),
            "female": ("female", "Female (1 = female, 0 = male)", "0/1"),
            "BMXBMI": ("bmi", "Body mass index", "kg/m²"),
            "INDFMPIR": ("income_poverty_ratio", "Family income ÷ poverty line (capped at 5)", "ratio"),
        },
    ),
}

SEX = {
    "name": "sex",
    "label": "Sex",
    "levels": [{"label": "Male", "column": None}, {"label": "Female", "column": "female"}],
    "reference": "Male",
}
ETHNICITY = {
    "name": "ethnicity",
    "label": "Race / ethnicity",
    "levels": [{"label": "Non-Hispanic White", "column": None}]
    + [{"label": lab, "column": c} for c, lab in ETH.values()],
    "reference": "Non-Hispanic White",
}


def summary(s: pd.Series) -> dict:
    return {k: round(float(v), 3) for k, v in
            {"mean": s.mean(), "sd": s.std(ddof=1), "min": s.min(), "max": s.max()}.items()}


def make_data(raw: Path, out: Path, raw_files: dict) -> None:
    out.mkdir(parents=True, exist_ok=True)
    meta, manifest = {}, {
        "built_by": "reproduce/reproduce.py in https://github.com/snsie/regression-activity",
        "dataset_definitions": f"regression-app pipeline/datasets.py at commit {nhanes.SOURCE_COMMIT} (copied into reproduce/nhanes.py)",
        "raw_files": raw_files,
        "versions": {"python": ".".join(map(str, sys.version_info[:2])), "pandas": pd.__version__,
                     "numpy": np.__version__, "scikit-learn": sklearn.__version__},
        "split": {"seed": SEED, "validation_share": VALIDATION_SHARE,
                  "method": "sklearn train_test_split(test_size=0.2, random_state=0) on row order"},
        "datasets": {},
    }
    for key, (loader, (tcol, tlabel, tunits), cols) in SPEC.items():
        ds = loader(raw)
        # round: the SAS reader turns some zeros into ~5e-79 (e.g. income ratio 0)
        X = ds["X"].rename(columns={k: v[0] for k, v in cols.items()}).round(4)
        features = [cols[c][0] for c in ds["X"].columns]
        binary = [c for c in features if set(np.unique(X[c])) <= {0.0, 1.0}]
        X[binary] = X[binary].astype(int)

        idx = np.arange(len(X))
        _, val_idx = train_test_split(idx, test_size=VALIDATION_SHARE, random_state=SEED)
        split = np.where(np.isin(idx, val_idx), "validation", "train")

        df = pd.concat([pd.DataFrame({"row_id": idx + 1, "split": split}), X,
                        ds["y"].rename(tcol).round(4).reset_index(drop=True)], axis=1)
        assert df[features + [tcol]].notna().all().all()
        assert np.isfinite(df[features + [tcol]].to_numpy(float)).all()
        df.to_csv(out / f"{key}.csv", index=False)

        groups = [SEX] + ([ETHNICITY] if key == "sbp" else [])
        if key == "sbp":  # at most one ethnicity indicator per row
            assert (df[[c for c, _ in ETH.values()]].sum(axis=1) <= 1).all()
        meta[key] = {
            "id": key,
            "name": ds["name"],
            "source": ds["source"],
            "citation": ds["citation"],
            "url": ds["url"],
            "target": tcol,
            "target_label": tlabel,
            "units": tunits,
            "features": [{"name": cols[c][0], "label": cols[c][1], "units": cols[c][2],
                          "binary": cols[c][0] in binary} for c in ds["X"].columns],
            "categorical_groups": groups,
        }
        manifest["datasets"][key] = {
            "file": f"{key}.csv",
            "n_rows": len(df),
            "n_train": int((split == "train").sum()),
            "n_validation": int((split == "validation").sum()),
            "feature_order": features,
            "target": tcol,
            "target_summary": summary(df[tcol]),
        }
        print(f"  {key}: {len(df)} rows ({manifest['datasets'][key]['n_train']} train, "
              f"{manifest['datasets'][key]['n_validation']} validation)")

    (out / "datasets.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
