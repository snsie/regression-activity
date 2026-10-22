# Reproduce the data and model outputs

Rebuilds everything in `starter/data/` and `starter/outputs/` (plus `starter/check.md`) from the original NHANES public-use files.

```bash
python3.11 -m venv .venv && . .venv/bin/activate
pip install -r reproduce/requirements.txt
python reproduce/reproduce.py --check     # rebuild in a temporary folder and compare with the committed files
python reproduce/reproduce.py             # rebuild in place (then rebuild the site: npm run build)
```

| Step | File | What it does |
|---|---|---|
| 1 | `nhanes.py` | Downloads 8 NHANES `.xpt` files from the CDC into `reproduce/raw/` (not committed). Checks each file's SHA-256 and stops if the CDC has revised one. Defines the three datasets; the definitions are copied from [regression-app](https://github.com/snsie/regression-app) `pipeline/datasets.py` at commit `54bce02`. |
| 2 | `make_data.py` | Writes the CSVs with readable columns, row IDs and a fixed 80/20 train/validation split (seed 0), plus `datasets.json` (labels, units) and `manifest.json` (provenance). |
| 3 | `build_outputs.py` | Fits the fixed models from `starter/m10.py` on the training rows and writes the JSON outputs and `check.md`. Before writing, it checks the math invariants: linear pushes add up to the prediction, the forest prediction is the average of its trees, boosting stages add up, and the exported trees match scikit-learn. |

Notes:
- **Exact versions:** `requirements.txt` pins the versions used (Python 3.11, scikit-learn 1.9.1). Other versions can change the forest and boosting outputs.
- **What `--check` compares:** CSVs and `check.md` must match byte for byte. JSON numbers may differ only by floating-point noise (relative 1e-9, absolute 1e-6).
- **On GitHub:** the **Reproduce data** workflow runs `--check` from a clean download. Start it from the Actions tab; it also runs when files in `reproduce/` or `starter/m10.py` change.
