"""Download the NHANES public-use files and define the three activity datasets.

The dataset definitions are copied from the regression-app pipeline
(https://github.com/snsie/regression-app, pipeline/datasets.py at commit
54bce02f8a93cf9839251894a4fff664dab97eef) so this folder works on its own.
"""

from __future__ import annotations

import hashlib
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

SOURCE_COMMIT = "54bce02f8a93cf9839251894a4fff664dab97eef"
URL_2017 = "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/{}.xpt"
URL_2011 = "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2011/DataFiles/{}.xpt"

# SHA-256 of the files used to build the committed data. A mismatch means the CDC
# has revised a file, so the rebuilt data may differ from the committed data.
FILES = {
    "DEMO_J": (URL_2017, "c0b46e0345ea19404928656277c8b0d10b0cca348a9b2fe4fc3c67e8b7ee73ec"),
    "BMX_J": (URL_2017, "8d675e42d8826ac98714b2c3dd4c5138a5e353fb4424f7eff5e6db4a01ce838a"),
    "BPX_J": (URL_2017, "f98f1d9a4c18173e715c749b4294f6f1525140d5ad5751316bb17cc038fb3423"),
    "GHB_J": (URL_2017, "35f07094573a0061a03ed609a5a363b34eb1b1c7065d1623b43d72e132a8a654"),
    "GLU_J": (URL_2017, "5b38897d0d7bfbc69dd9ca74ffdaf2f6a9bed5a91d4a7bf46e07f1332cc3379e"),
    "DEMO_G": (URL_2011, "eaf0525d1952626885af3e935415a1f66ad62c18698080e7354789c125af252d"),
    "BMX_G": (URL_2011, "4814bfc3047ed400b9d43d285f8c3ea7c940ac6489404a9b699579715d158ec3"),
    "SPX_G": (URL_2011, "58177b07ad94a2c005b0c9494cddb82fc94ec8f5c6c13a91b83da035f20770d9"),
}

NHANES_CITE = (
    "Centers for Disease Control and Prevention, National Center for Health "
    "Statistics. National Health and Nutrition Examination Survey 2017-2018."
)
NHANES_LINK = "https://wwwn.cdc.gov/nchs/nhanes/continuousnhanes/default.aspx?BeginYear=2017"
NHANES_2011_CITE = (
    "Centers for Disease Control and Prevention, National Center for Health "
    "Statistics. National Health and Nutrition Examination Survey 2011-2012."
)
NHANES_2011_LINK = "https://wwwn.cdc.gov/nchs/nhanes/continuousnhanes/default.aspx?BeginYear=2011"

ETHNICITY = {
    1: "Mexican American",
    2: "Other Hispanic",
    3: "Non-Hispanic White",
    4: "Non-Hispanic Black",
    6: "Non-Hispanic Asian",
    7: "Other / multiracial",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def download(raw: Path) -> dict[str, dict]:
    """Fetch any missing files into raw/ and check every hash. Returns provenance."""
    raw.mkdir(parents=True, exist_ok=True)
    out = {}
    for name, (url, expected) in FILES.items():
        path = raw / f"{name}.xpt"
        if not path.exists():
            print(f"downloading {url.format(name)}")
            req = urllib.request.Request(url.format(name), headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=300) as r:
                path.write_bytes(r.read())
        got = sha256(path)
        if got != expected:
            raise SystemExit(f"{name}.xpt has SHA-256 {got}, expected {expected}. "
                             "The CDC may have revised it; delete it to re-download, or update FILES.")
        out[name] = {"url": url.format(name), "sha256": got}
    return out


def _read(raw: Path, f: str) -> pd.DataFrame:
    return pd.read_sas(raw / f"{f}.xpt").set_index("SEQN")


def _nhanes_adults(raw: Path) -> pd.DataFrame:
    d = (
        _read(raw, "DEMO_J")[["RIAGENDR", "RIDAGEYR", "RIDRETH3", "INDFMPIR"]]
        .join(_read(raw, "BMX_J")[["BMXBMI", "BMXWAIST", "BMXHT", "BMXWT"]])
        .join(_read(raw, "BPX_J")[["BPXSY1", "BPXSY2", "BPXSY3"]])
        .join(_read(raw, "GHB_J")[["LBXGH"]])
        .join(_read(raw, "GLU_J")[["LBXGLU"]], how="left")
    )
    d = d[d.RIDAGEYR >= 18].copy()
    d["SBP"] = d[["BPXSY1", "BPXSY2", "BPXSY3"]].mean(axis=1)
    d["female"] = (d.RIAGENDR == 2).astype(float)
    return d


def _nhanes_spirometry(raw: Path) -> pd.DataFrame:
    """NHANES 2011-2012 participants aged 6-79 with a complete baseline spirometry test."""
    d = (
        _read(raw, "SPX_G")[["SPXNSTAT", "SPXNFEV1"]]
        .join(_read(raw, "DEMO_G")[["RIAGENDR", "RIDAGEYR", "INDFMPIR"]])
        .join(_read(raw, "BMX_G")[["BMXBMI"]])
    )
    d = d[(d.SPXNSTAT == 1) & d.SPXNFEV1.notna()].copy()
    d["female"] = (d.RIAGENDR == 2).astype(float)
    return d


def glucose(raw: Path) -> dict:
    d = _nhanes_adults(raw)
    cols = ["LBXGH", "RIDAGEYR", "BMXBMI", "BMXWAIST", "female"]
    s = d[cols + ["LBXGLU"]].dropna()
    return {"name": "NHANES: HbA1c → fasting glucose",
            "source": "NHANES 2017-2018 (CDC), adults in the fasting subsample",
            "citation": NHANES_CITE, "url": NHANES_LINK,
            "X": s[cols].reset_index(drop=True), "y": s.LBXGLU.reset_index(drop=True)}


def sbp(raw: Path) -> dict:
    d = _nhanes_adults(raw)
    d = d[d.RIDRETH3.isin(ETHNICITY)]
    cols = ["RIDAGEYR", "BMXBMI", "BMXWAIST", "female", "INDFMPIR"]
    s = d[cols + ["SBP", "RIDRETH3"]].dropna().copy()
    eth = pd.get_dummies(s.RIDRETH3.map(ETHNICITY), prefix="eth", dtype=float)
    eth = eth.drop(columns="eth_Non-Hispanic White")
    X = pd.concat([s[cols], eth], axis=1)
    return {"name": "NHANES: systolic blood pressure",
            "source": "NHANES 2017-2018 (CDC), adults with complete measurements",
            "citation": NHANES_CITE, "url": NHANES_LINK,
            "X": X.reset_index(drop=True), "y": s.SBP.reset_index(drop=True)}


def fev1(raw: Path) -> dict:
    d = _nhanes_spirometry(raw)
    cols = ["RIDAGEYR", "female", "BMXBMI", "INDFMPIR"]
    s = d[cols + ["SPXNFEV1"]].dropna()
    return {"name": "NHANES: lung function (FEV₁)",
            "source": ("NHANES 2011-2012 (CDC), ages 6-79 with complete spirometry. "
                       "Height is left out on purpose, so the age curve has to be learned"),
            "citation": NHANES_2011_CITE, "url": NHANES_2011_LINK,
            "X": s[cols].reset_index(drop=True), "y": s.SPXNFEV1.reset_index(drop=True)}

