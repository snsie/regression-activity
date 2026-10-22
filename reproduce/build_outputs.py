"""Step 2: fit the fixed models and export the reference outputs students explain.

Writes into <starter>/outputs/:
  <key>.json                 everything the app sections need (see outputs/SCHEMA.md)
  <key>_boosting_trees.json  the 500 boosting trees, for live custom-input predictions
and <starter>/check.md, the numbers students compare their app against.
Every invariant (pushes add up, trees average to the forest, boosting stages add up,
exported trees match scikit-learn) is asserted before anything is written.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn

STARTER = Path(__file__).resolve().parent.parent / "starter"
sys.path.insert(0, str(STARTER))
import m10  # noqa: E402  (the starter's own helper, so the apps and these outputs share one definition)

DIGITS = 4
TRACE_TREES = 5  # decision paths exported for the first few forest trees
SNAPSHOT_ROUNDS = [0, 1, 2, 3, 5, 10, 25, 50, 100, 200, 300, 400, 500]
SNAPSHOT_ROWS = 200


def rnd(v, d: int = DIGITS):
    if isinstance(v, dict):
        return {k: rnd(x, d) for k, x in v.items()}
    if isinstance(v, (list, tuple, np.ndarray)):
        return [rnd(x, d) for x in v]
    return round(float(v), d)


def rmse(y, p) -> float:
    return float(np.sqrt(np.mean((np.asarray(y) - np.asarray(p)) ** 2)))


def pick_people(val: pd.DataFrame, target: str, tree_sd: np.ndarray) -> list[tuple[str, int, str]]:
    """Five validation people: low / typical / high outcome, and most / least tree disagreement."""
    chosen, people = set(), []

    def take(pos: int, why: str):
        while int(val.index[pos]) in chosen:  # never repeat a person
            pos = (pos + 1) % len(val)
        chosen.add(int(val.index[pos]))
        people.append((f"P{len(people) + 1}", int(val.index[pos]), why))

    order = np.argsort(val[target].to_numpy(), kind="stable")
    for q, why in [(0.1, "low outcome"), (0.5, "typical outcome"), (0.9, "high outcome")]:
        take(int(order[int(q * (len(val) - 1))]), why)
    take(int(np.argmax(tree_sd)), "trees disagree most")
    take(int(np.argmin(tree_sd)), "trees agree most")
    return people


def describe(row: pd.Series, meta: dict) -> str:
    sex = "Female" if row["female"] == 1 else "Male"
    return f"{sex}, age {row['age']:.0f}"


def export_tree(t) -> dict:
    tr = t.tree_
    return {"feature": tr.feature.tolist(), "threshold": [float(v) for v in tr.threshold],
            "left": tr.children_left.tolist(), "right": tr.children_right.tolist(),
            "value": [float(v) for v in tr.value[:, 0, 0]]}


def decision_path(t, x: np.ndarray, names: list[str]) -> dict:
    tr, node, steps = t.tree_, 0, []
    x32 = x.astype(np.float32).astype(np.float64)  # scikit-learn: float32 inputs, float64 thresholds
    while tr.children_left[node] != -1:
        f, thr = tr.feature[node], tr.threshold[node]
        left = x32[f] <= thr
        steps.append({"feature": names[f], "threshold": rnd(thr), "goes": "≤" if left else ">"})
        node = tr.children_left[node] if left else tr.children_right[node]
    return {"steps": steps, "leaf_value": rnd(tr.value[node, 0, 0])}


def build(key: str, meta: dict) -> tuple[dict, dict]:
    df = m10.load_data(key)
    feats = [f["name"] for f in meta["features"]]
    target = meta["target"]
    train, val = df[df.split == "train"], df[df.split == "validation"].reset_index(drop=True)
    Xtr, ytr = train[feats].to_numpy(float), train[target].to_numpy(float)
    Xva, yva = val[feats].to_numpy(float), val[target].to_numpy(float)
    assert set(train.row_id).isdisjoint(val.row_id)

    models = m10.make_models()
    for m in models.values():
        m.fit(Xtr, ytr)
    lin, rf, gb = models["linear"], models["forest"], models["boosting"]

    # people
    tree_va = np.array([t.predict(Xva) for t in rf.estimators_])  # (100, n_val)
    picks = pick_people(val, target, tree_va.std(axis=0))
    people = []
    for pid, i, why in picks:
        row = val.loc[i]
        people.append({"id": pid, "label": f"Example person {pid[1:]}", "description": describe(row, meta),
                       "why_chosen": why, "row_id": int(row.row_id), "split": "validation",
                       "values": {f: float(row[f]) for f in feats}, "observed": float(row[target])})
    Xp = np.array([[p["values"][f] for f in feats] for p in people])

    # feature stats from training rows only
    stats = {f: {"train_mean": train[f].mean(), "train_sd": train[f].std(ddof=1),
                 "min": train[f].min(), "max": train[f].max(),
                 "p01": train[f].quantile(0.01), "p99": train[f].quantile(0.99)} for f in feats}

    # ---- linear
    ref = {f: float(train[f].mean()) for f in feats}
    coef = dict(zip(feats, lin.coef_))
    baseline = lin.intercept_ + sum(coef[f] * ref[f] for f in feats)
    assert abs(baseline - lin.predict(np.array([[ref[f] for f in feats]]))[0]) < 1e-6
    lin_people = {}
    for p, x in zip(people, Xp):
        pushes = {f: coef[f] * (p["values"][f] - ref[f]) for f in feats}
        pred = lin.predict(x[None])[0]
        assert abs(baseline + sum(pushes.values()) - pred) < 1e-6
        lin_people[p["id"]] = {"prediction": rnd(pred), "pushes": rnd(pushes),
                               "grouped_pushes": rnd(m10.group_pushes(meta, pushes))}
    binary = {f["name"] for f in meta["features"] if f["binary"]}
    linear = {
        "intercept": rnd(lin.intercept_, 6), "coefficients": rnd(coef, 6), "reference": rnd(ref, 6),
        "reference_description": "training-set average of every column (a mathematical reference, not a real person)",
        "baseline": rnd(baseline, 6),
        "typical_effect_per_sd": {f: rnd(coef[f] * stats[f]["train_sd"]) for f in feats if f not in binary},
        "rmse": {"train": rnd(rmse(ytr, lin.predict(Xtr))), "validation": rnd(rmse(yva, lin.predict(Xva)))},
        "people": lin_people,
    }

    # ---- forest
    tree_p = np.array([t.predict(Xp) for t in rf.estimators_])  # (100, n_people)
    assert np.allclose(tree_p.mean(axis=0), rf.predict(Xp))
    running_va = np.cumsum(tree_va, axis=0) / np.arange(1, 101)[:, None]
    assert np.allclose(running_va[-1], rf.predict(Xva))
    forest = {
        "settings": m10.FOREST, "n_trees": len(rf.estimators_),
        "features_tried_per_split": int(max(1, int(np.sqrt(len(feats))))),
        "n_features": len(feats),
        "bootstrap_unique_training_rows": [int(len(np.unique(s))) for s in rf.estimators_samples_],
        "n_training_rows": len(train),
        "root_split": [{"feature": feats[t.tree_.feature[0]], "threshold": rnd(t.tree_.threshold[0])}
                       for t in rf.estimators_],
        "training_target_range": [rnd(ytr.min()), rnd(ytr.max())],
        "validation_rmse_by_trees": rnd([rmse(yva, running_va[k]) for k in range(100)]),
        "rmse": {"train": rnd(rmse(ytr, rf.predict(Xtr))), "validation": rnd(rmse(yva, rf.predict(Xva)))},
        "people": {p["id"]: {"prediction": rnd(rf.predict(x[None])[0]), "tree_predictions": rnd(tree_p[:, j]),
                             "traced_trees": [decision_path(rf.estimators_[k], x, feats) for k in range(TRACE_TREES)]}
                   for j, (p, x) in enumerate(zip(people, Xp))},
    }

    # ---- boosting (0.1 is the main model; 0.02 is a separately fitted comparison)
    def staged_info(model):
        init = float(model.init_.constant_.ravel()[0]) if hasattr(model.init_, "constant_") else float(ytr.mean())
        assert abs(init - ytr.mean()) < 1e-6  # round 0 = training mean
        st_tr = np.vstack([np.full(len(ytr), init)] + list(model.staged_predict(Xtr)))
        st_va = np.vstack([np.full(len(yva), init)] + list(model.staged_predict(Xva)))
        st_p = np.vstack([np.full(len(Xp), init)] + list(model.staged_predict(Xp)))
        assert np.allclose(st_p[-1], model.predict(Xp))
        corr = np.array([model.learning_rate * t[0].predict(Xp) for t in model.estimators_])
        assert np.allclose(st_p[0] + np.cumsum(corr, axis=0), st_p[1:])  # learning rate applied once
        tr_curve = [rmse(ytr, s) for s in st_tr]
        va_curve = [rmse(yva, s) for s in st_va]
        return init, st_tr, st_p, corr, tr_curve, va_curve

    init, st_tr, st_p, corr, tr_curve, va_curve = staged_info(gb)
    best = int(np.argmin(va_curve))
    rng = np.random.default_rng(0)
    snap_idx = np.sort(rng.choice(len(train), size=SNAPSHOT_ROWS, replace=False))
    boosting = {
        "settings": m10.BOOSTING, "learning_rate": gb.learning_rate, "init": rnd(init, 6),
        "init_description": "round 0: the average outcome in the training rows",
        "rmse": {"train": rnd(tr_curve), "validation": rnd(va_curve)},
        "best_validation_round": best, "best_validation_rmse": rnd(va_curve[best]),
        "people": {p["id"]: {"staged": rnd(st_p[:, j]), "corrections": rnd(corr[:, j])}
                   for j, p in enumerate(people)},
        "residual_snapshots": {
            "rounds": SNAPSHOT_ROUNDS,
            "row_ids": train.row_id.to_numpy()[snap_idx].tolist(),
            "observed": rnd(ytr[snap_idx]),
            "predictions": {str(r): rnd(st_tr[r, snap_idx]) for r in SNAPSHOT_ROUNDS},
        },
    }
    gb2 = m10.make_models(learning_rate=0.02)["boosting"].fit(Xtr, ytr)
    _, _, st_p2, _, tr2, va2 = staged_info(gb2)
    boosting["comparison_learning_rate_0_02"] = {
        "note": "a separately fitted model with learning_rate=0.02; not a rescaled copy of the main model",
        "rmse": {"train": rnd(tr2), "validation": rnd(va2)},
        "best_validation_round": int(np.argmin(va2)), "best_validation_rmse": rnd(min(va2)),
        "people": {p["id"]: {"staged": rnd(st_p2[:, j])} for j, p in enumerate(people)},
    }

    bundle = {
        **meta, "n_train": len(train), "n_validation": len(val),
        "split_description": "fixed 80/20 split (seed 0); the 20% is validation data used to choose a stopping round",
        "feature_stats": {f: rnd(s) for f, s in stats.items()},
        "people": people, "linear": linear, "forest": forest, "boosting": boosting,
        "versions": {"scikit-learn": sklearn.__version__, "numpy": np.__version__, "pandas": pd.__version__},
    }
    trees = {"feature_order": feats, "init": init, "learning_rate": gb.learning_rate,
             "comparison": "x is cast to float32 before each threshold test, as scikit-learn does",
             "trees": [export_tree(t[0]) for t in gb.estimators_]}
    return bundle, trees


def check_rows(key: str, b: dict) -> list[str]:
    u = b["units"]
    p = b["people"][0]
    lin, rf, gb = b["linear"], b["forest"], b["boosting"]
    pid = p["id"]
    top = max(lin["people"][pid]["grouped_pushes"].items(), key=lambda kv: kv[1])
    labels = {g["name"]: g["label"] for g in b["categorical_groups"]} | {f["name"]: f["label"] for f in b["features"]}
    return [
        f"| {b['name']} | Linear | {p['label']} ({p['description']}) | starting point **{lin['baseline']:.1f}** + pushes = prediction **{lin['people'][pid]['prediction']:.1f}** {u}; biggest upward push: {labels[top[0]]} (+{top[1]:.1f}) |",
        f"| | Forest | {p['label']} | average of all {rf['n_trees']} trees = **{rf['people'][pid]['prediction']:.1f}** {u}; tree 1 alone = {rf['people'][pid]['tree_predictions'][0]:.1f} |",
        f"| | Boosting | {p['label']} | round 0 = **{gb['init']:.1f}**; round 1 = {gb['people'][pid]['staged'][1]:.1f}; round 500 = **{gb['people'][pid]['staged'][-1]:.1f}** {u} |",
        f"| | Boosting | validation curve | lowest validation RMSE **{gb['best_validation_rmse']:.1f}** {u} at round **{gb['best_validation_round']}** |",
    ]


def build_outputs(starter: Path = STARTER) -> None:
    m10.DATA, m10.OUTPUTS = starter / "data", starter / "outputs"
    m10.load_bundle.cache_clear()
    m10.load_boosting_trees.cache_clear()
    OUT = m10.OUTPUTS
    OUT.mkdir(exist_ok=True)
    meta_all = json.loads((m10.DATA / "datasets.json").read_text())
    rows = []
    for key in m10.DATASETS:
        bundle, trees = build(key, meta_all[key])
        (OUT / f"{key}.json").write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")))
        (OUT / f"{key}_boosting_trees.json").write_text(json.dumps(trees, separators=(",", ":")))
        m10.load_bundle.cache_clear()
        m10.load_boosting_trees.cache_clear()
        for p in bundle["people"]:  # the exported trees (used by apps) match scikit-learn
            live = m10.boosting_rounds(key, p["values"])["staged"]
            assert np.allclose(live, bundle["boosting"]["people"][p["id"]]["staged"], atol=1e-3), (key, p["id"])
        rows += check_rows(key, bundle)
        print(f"  {key}: linear val RMSE {bundle['linear']['rmse']['validation']}, "
              f"forest {bundle['forest']['rmse']['validation']}, "
              f"boosting best round {bundle['boosting']['best_validation_round']} "
              f"({bundle['boosting']['best_validation_rmse']})")

    check = ["# Check your app", "",
             "Pick **Example person 1** in each section and compare. If your app shows different numbers, "
             "ask your agent why before you change anything.", "",
             "| Dataset | Section | What to pick | Your app should show |", "|---|---|---|---|", *rows, "",
             "**Not a bug:** for lung function, the straight line predicts far too much for Example person 1, a "
             "9-year-old. One straight line can't follow lungs growing in childhood and shrinking later. "
             "Showing where the line fails is a strength of an explainer, not a mistake.", "",
             "**Pushes are measured from the training average**, including the average mix of men and women "
             "(and of ethnic groups). So even a man, or a Non-Hispanic White person, gets a small sex or "
             "ethnicity push. The \"reference group\" is only how the 0/1 columns are coded.", ""]
    (starter / "check.md").write_text("\n".join(check))

