"""Tabel threshold model final: apa yang terjadi di test set untuk tiap ambang skor.

Memakai pipeline, model, dan split yang sama dengan ``lead_scoring.py`` (di-import,
bukan disalin). Hasilnya dibaca oleh figur interaktif di ``docs/threshold/``.

Output
------
* ``reports/threshold_table.csv``: satu baris per ambang 0,05-0,95 (langkah 0,01)
  plus satu baris Top 20% (ambang = persentil ke-80 skor).
* ``reports/threshold_table.json``: isi yang sama plus metadata (base rate,
  ROC-AUC, ambang pilihan dari CV train).
"""

import json

import numpy as np
import pandas as pd
import sklearn
from sklearn.metrics import roc_auc_score

from lead_scoring import (
    FINAL_MODEL,
    REPORT_DIR,
    TARGET_PRECISION,
    TOP_FRACTION,
    find_threshold,
    make_models,
    split_data,
    top_k_metrics,
)

THRESHOLDS = np.round(np.arange(0.05, 0.951, 0.01), 2)


def threshold_row(label, threshold, y_true, proba):
    """Hitung metrik jika semua nasabah dengan skor >= ``threshold`` ditelepon.

    Parameters
    ----------
    label : str
        Nama baris (mis. ``"0.56"`` atau ``"Top 20%"``).
    threshold : float
        Ambang skor.
    y_true : numpy.ndarray of int
        Label sebenarnya (1 = deposit).
    proba : numpy.ndarray of float
        Skor probabilitas model.

    Returns
    -------
    dict
        Jumlah & persen ditelepon, TP, FP, FN, precision, recall, dan lift.
    """
    called = proba >= threshold
    n_called = int(called.sum())
    tp = int(y_true[called].sum())
    precision = tp / n_called if n_called else None
    return {
        "label": label,
        "threshold": round(float(threshold), 4),
        "n_called": n_called,
        "pct_called": n_called / len(y_true),
        "tp": tp,
        "fp": n_called - tp,
        "fn": int(y_true.sum()) - tp,
        "precision": precision,
        "recall": tp / y_true.sum(),
        "lift": precision / y_true.mean() if n_called else None,
    }


def main():
    """Latih model final, hitung tabel threshold di test set, dan simpan."""
    X_train, X_test, y_train, y_test = split_data()
    model = make_models()[FINAL_MODEL]
    model.fit(X_train, y_train)
    proba = model.predict_proba(X_test)[:, 1]
    y = np.asarray(y_test)

    rows = [threshold_row(f"{t:.2f}", t, y, proba) for t in THRESHOLDS]
    top_thr = np.percentile(proba, 100 * (1 - TOP_FRACTION))
    top_row = threshold_row(f"Top {TOP_FRACTION:.0%}", top_thr, y, proba)

    table = pd.DataFrame(rows + [top_row])
    table.to_csv(REPORT_DIR / "threshold_table.csv", index=False, float_format="%.6f")

    chosen = find_threshold(model, X_train, y_train)
    meta = {
        "model": FINAL_MODEL,
        "n_test": len(y),
        "n_positive": int(y.sum()),
        "base_rate": float(y.mean()),
        "roc_auc": float(roc_auc_score(y, proba)),
        "chosen_threshold": chosen,
        "chosen_threshold_note": (
            f"ambang terendah dengan precision >= {TARGET_PRECISION:.0%} "
            "di prediksi out-of-fold data train (5-fold CV)"
        ),
        "top_fraction": TOP_FRACTION,
        "sklearn_version": sklearn.__version__,
    }
    payload = {"meta": meta, "rows": rows, "top": top_row}
    (REPORT_DIR / "threshold_table.json").write_text(
        json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8"
    )

    capture, prec_top, lift = top_k_metrics(y, proba)
    print(f"Test: {len(y)} nasabah, base rate {y.mean():.3f}, ROC-AUC {meta['roc_auc']:.3f}")
    print(f"Ambang pilihan (CV train): {chosen}")
    print(f"Top {TOP_FRACTION:.0%} via top_k_metrics: precision={prec_top:.3f}, "
          f"capture={capture:.3f}, lift={lift:.2f}")  # fmt: skip
    show = {"0.30", "0.50", f"{chosen:.2f}", "0.70", top_row["label"]}
    pd.set_option("display.width", 200)
    print(table[table["label"].isin(show)].round(3).to_string(index=False))


if __name__ == "__main__":
    main()
