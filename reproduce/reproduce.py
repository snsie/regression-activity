"""Rebuild the starter's data and model outputs from the raw NHANES files.

    pip install -r reproduce/requirements.txt          # pinned versions (Python 3.11)
    python reproduce/reproduce.py                       # rebuild starter/data, starter/outputs, starter/check.md
    python reproduce/reproduce.py --check               # rebuild in a temporary folder and compare with the committed files

Raw files are downloaded from the CDC into reproduce/raw/ (not committed) and checked
against known SHA-256 hashes before use.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import nhanes  # noqa: E402
from build_outputs import STARTER, build_outputs  # noqa: E402
from make_data import make_data  # noqa: E402

GENERATED = ["data/glucose.csv", "data/sbp.csv", "data/fev1.csv", "data/datasets.json", "data/manifest.json",
             "outputs/glucose.json", "outputs/sbp.json", "outputs/fev1.json",
             "outputs/glucose_boosting_trees.json", "outputs/sbp_boosting_trees.json",
             "outputs/fev1_boosting_trees.json", "check.md"]


def same_json(a, b, path="") -> list[str]:
    """Differences between two JSON values; numbers may differ by floating-point noise only."""
    if isinstance(a, dict) and isinstance(b, dict):
        if a.keys() != b.keys():
            return [f"{path}: keys differ"]
        return [d for k in a for d in same_json(a[k], b[k], f"{path}.{k}")]
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return [f"{path}: length {len(a)} vs {len(b)}"]
        return [d for i, (x, y) in enumerate(zip(a, b)) for d in same_json(x, y, f"{path}[{i}]")]
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return [] if math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-6) else [f"{path}: {a} vs {b}"]
    return [] if a == b else [f"{path}: {a!r} vs {b!r}"]


def compare(built: Path, committed: Path) -> list[str]:
    problems = []
    for rel in GENERATED:
        new, old = built / rel, committed / rel
        if not old.exists():
            problems.append(f"{rel}: not committed")
        elif rel.endswith(".json"):
            problems += [f"{rel}{d}" for d in same_json(json.loads(new.read_text()), json.loads(old.read_text()))[:5]]
        elif new.read_bytes() != old.read_bytes():
            problems.append(f"{rel}: contents differ")
    return problems


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="rebuild in a temporary folder and compare with the committed files")
    ap.add_argument("--raw", type=Path, default=HERE / "raw", help="folder for the raw NHANES .xpt files")
    a = ap.parse_args()

    print("1. Raw NHANES files")
    raw_files = nhanes.download(a.raw)
    with tempfile.TemporaryDirectory() as tmp:
        target = STARTER
        if a.check:
            target = Path(tmp) / "starter"
            shutil.copytree(STARTER, target)
        print("2. Datasets")
        make_data(a.raw, target / "data", raw_files)
        print("3. Model outputs")
        build_outputs(target)
        if not a.check:
            print(f"Rebuilt {len(GENERATED)} files in {STARTER}.")
            return
        problems = compare(target, STARTER)
    if problems:
        print("MISMATCH with the committed files:\n  " + "\n  ".join(problems))
        sys.exit(1)
    print(f"Reproduced: all {len(GENERATED)} generated files match the committed versions.")


if __name__ == "__main__":
    main()
