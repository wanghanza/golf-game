"""CaddieSet analysis: ball-flight distributions, ball-flight relationships and
a participant-independent baseline model from swing-pose features.

Data: https://github.com/damilab/CaddieSet (MIT licence, data/CaddieSet.csv).
The CSV is NOT committed here; it is fetched into data-research/.cache/.

Usage:
    python data-research/caddieset_analysis.py [path/to/CaddieSet.csv]

Writes data-research/results/caddieset_summary.json and
data-research/results/caddieset_shots.json (ball-flight columns only, used by
compare_physics.mjs).
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression, LogisticRegression, Ridge
from sklearn.metrics import balanced_accuracy_score, mean_absolute_error, r2_score
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache"
RESULTS = HERE / "results"
REPO = "https://github.com/damilab/CaddieSet"
BALL_COLS = ["Distance", "Carry", "LrDistanceOut", "DirectionAngle", "SpinBack", "SpinSide", "SpinAxis", "BallSpeed"]


def load(path: str | None) -> pd.DataFrame:
    if path is None:
        target = CACHE / "CaddieSet"
        if not (target / "data" / "CaddieSet.csv").exists():
            CACHE.mkdir(parents=True, exist_ok=True)
            subprocess.run(["git", "clone", "--depth", "1", REPO, str(target)], check=True)
        path = str(target / "data" / "CaddieSet.csv")
    return pd.read_csv(path)


def describe(df: pd.DataFrame) -> dict:
    out = {}
    for club, g in df.groupby("ClubType"):
        out[club] = {
            "n": int(len(g)),
            "golfers": int(g["GolferId"].nunique()),
            **{
                c: {
                    "mean": float(g[c].mean()),
                    "std": float(g[c].std()),
                    "p10": float(g[c].quantile(0.1)),
                    "median": float(g[c].median()),
                    "p90": float(g[c].quantile(0.9)),
                }
                for c in BALL_COLS
            },
        }
    return out


def ball_flight_laws(df: pd.DataFrame) -> dict:
    """How well do start direction + spin axis explain the lateral result?"""
    out = {}
    for club in ["W1", "I7"]:
        g = df[df.ClubType == club].copy()
        # Spin axis should be atan2(SpinSide, SpinBack): check the dataset's convention.
        axis_from_components = np.degrees(np.arctan2(g.SpinSide, g.SpinBack))
        axis_consistency = float(np.corrcoef(axis_from_components, g.SpinAxis)[0, 1])
        X = np.column_stack([g.Carry * np.tan(np.radians(g.DirectionAngle)), g.Carry * np.sin(np.radians(g.SpinAxis))])
        y = g.LrDistanceOut.to_numpy()
        lr = LinearRegression().fit(X, y)
        pred = lr.predict(X)
        corr_dir = float(np.corrcoef(g.DirectionAngle, g.LrDistanceOut)[0, 1])
        corr_axis = float(np.corrcoef(g.SpinAxis, g.LrDistanceOut)[0, 1])
        out[club] = {
            "n": int(len(g)),
            "spinAxis_vs_atan2(side,back)_corr": axis_consistency,
            "corr(DirectionAngle, LrDistanceOut)": corr_dir,
            "corr(SpinAxis, LrDistanceOut)": corr_axis,
            "lateral_model": "LrDistanceOut ~ a*Carry*tan(Direction) + b*Carry*sin(SpinAxis) + c",
            "coef": [float(c) for c in lr.coef_],
            "intercept": float(lr.intercept_),
            "r2_in_sample": float(r2_score(y, pred)),
            "zero_lateral_fraction": float((g.LrDistanceOut == 0).mean()),
        }
    return out


def pose_baselines(df: pd.DataFrame) -> dict:
    """Leave-one-golfer-out models from pose features (camera-derived), as a
    reference for what swing kinematics alone can predict. Golfers with fewer
    than 30 shots are excluded from the test folds' statistics only implicitly
    (they still form their own fold)."""
    feat_cols = [c for c in df.columns if c[0].isdigit() and "-" in c]
    out = {}
    for club in ["W1", "I7"]:
        g = df[df.ClubType == club].reset_index(drop=True)
        X = g[feat_cols].apply(pd.to_numeric, errors="coerce").to_numpy(float, copy=True)  # some cells hold spreadsheet errors like "#NAME?"
        X[~np.isfinite(X)] = np.nan  # inf values occur in a few derived ratios
        keep = ~np.all(np.isnan(X), axis=0)
        X = X[:, keep]
        groups = g.GolferId.to_numpy()
        logo = LeaveOneGroupOut()
        res = {"n": int(len(g)), "golfers": int(len(np.unique(groups))), "features": int(X.shape[1])}
        # Ball speed regression.
        y = g.BallSpeed.to_numpy(float)
        preds, base = np.zeros_like(y), np.zeros_like(y)
        for tr, te in logo.split(X, y, groups):
            m = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), Ridge(alpha=10.0)).fit(X[tr], y[tr])
            preds[te] = m.predict(X[te])
            base[te] = DummyRegressor().fit(X[tr], y[tr]).predict(X[te])
        res["ballSpeed"] = {
            "model": "Ridge(alpha=10) on pose features, leave-one-golfer-out",
            "r2": float(r2_score(y, preds)),
            "mae_mps": float(mean_absolute_error(y, preds)),
            "baseline_mean_r2": float(r2_score(y, base)),
            "baseline_mean_mae_mps": float(mean_absolute_error(y, base)),
        }
        # Stronger regularisation, and the (leaky) shot-level split for contrast.
        for alpha in (1e3, 1e5):
            p2 = np.zeros_like(y)
            for tr, te in logo.split(X, y, groups):
                m = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), Ridge(alpha=alpha)).fit(X[tr], y[tr])
                p2[te] = m.predict(X[te])
            res["ballSpeed"][f"logo_r2_alpha_{alpha:g}"] = float(r2_score(y, p2))
        from sklearn.model_selection import KFold
        p3 = np.zeros_like(y)
        for tr, te in KFold(5, shuffle=True, random_state=42).split(X):
            m = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), Ridge(alpha=10.0)).fit(X[tr], y[tr])
            p3[te] = m.predict(X[te])
        res["ballSpeed"]["shot_level_kfold_r2_LEAKY"] = float(r2_score(y, p3))
        # Start direction class: left (< -2 deg) / centre / right (> 2 deg).
        cls = np.where(g.DirectionAngle < -2, 0, np.where(g.DirectionAngle > 2, 2, 1))
        pc, bc = np.zeros_like(cls), np.zeros_like(cls)
        for tr, te in logo.split(X, cls, groups):
            if len(np.unique(cls[tr])) < 2:
                pc[te] = cls[tr][0]
                bc[te] = cls[tr][0]
                continue
            m = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(C=0.1, max_iter=2000)).fit(X[tr], cls[tr])
            pc[te] = m.predict(X[te])
            bc[te] = DummyClassifier(strategy="most_frequent").fit(X[tr], cls[tr]).predict(X[te])
        res["directionClass"] = {
            "model": "LogisticRegression(C=0.1) on pose features, leave-one-golfer-out",
            "classes": "0: < -2 deg, 1: centre, 2: > 2 deg",
            "balanced_accuracy": float(balanced_accuracy_score(cls, pc)),
            "baseline_majority_balanced_accuracy": float(balanced_accuracy_score(cls, bc)),
            "class_counts": {int(k): int(v) for k, v in zip(*np.unique(cls, return_counts=True))},
        }
        out[club] = res
    return out


def main() -> None:
    df = load(sys.argv[1] if len(sys.argv) > 1 else None)
    RESULTS.mkdir(parents=True, exist_ok=True)
    summary = {
        "dataset": "CaddieSet (CVPRW 2025), damilab/CaddieSet, MIT licence",
        "rows": int(len(df)),
        "golfers": int(df.GolferId.nunique()),
        "units_inferred": "distances in metres, BallSpeed in m/s, spin in rpm, angles in degrees "
        "(inferred: carry vs ball speed matches metres; SpinAxis == atan2(SpinSide, SpinBack))",
        "no_launch_angle": "The CSV has no vertical launch angle column.",
        "per_club": describe(df),
        "ball_flight_laws": ball_flight_laws(df),
        "pose_feature_baselines": pose_baselines(df),
    }
    (RESULTS / "caddieset_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    shots = df[["ClubType", "GolferId", *BALL_COLS]].to_dict(orient="records")
    (RESULTS / "caddieset_shots.json").write_text(json.dumps(shots) + "\n")
    print(json.dumps({k: summary[k] for k in ("rows", "golfers")}, indent=2))
    print(json.dumps(summary["ball_flight_laws"], indent=2))
    print(json.dumps(summary["pose_feature_baselines"], indent=2))


if __name__ == "__main__":
    main()
