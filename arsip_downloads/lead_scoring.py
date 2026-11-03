"""Lead scoring nasabah deposito berjangka (dataset Bank Marketing).

Tujuan: memberi skor probabilitas tiap nasabah agar tim telemarketing hanya
menelepon ~20% nasabah dengan skor tertinggi.

Keputusan desain utama
----------------------
* Split train/test dilakukan SEBELUM preprocessing; semua langkah
  (imputasi, IQR capping, scaling, encoding) dipelajari hanya dari data train.
* Preprocessing dibungkus ``Pipeline`` sehingga data baru diproses identik.
* ``duration`` dikeluarkan: nilainya baru diketahui setelah telepon selesai.
* Evaluasi memakai metrik Top 20% (capture rate, precision, lift) beserta
  interval kepercayaan bootstrap.
"""

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    confusion_matrix,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import cross_val_predict, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "bank.csv"
REPORT_DIR = ROOT / "reports"
RANDOM_STATE = 42
TOP_FRACTION = 0.20  # tim telemarketing fokus ke 20% nasabah teratas
TARGET_PRECISION = 0.80  # target Precision pada laporan progres
USE_DURATION = False  # True = pakai `duration` (tidak realistis untuk scoring)

IMPUTE_UNKNOWN = ["job", "education", "contact"]
NUMERIC = ["age", "balance", "campaign", "pdays", "contacted_before", "has_loan_any"]
CATEGORICAL = [
    "job", "marital", "education", "default", "housing",
    "loan", "contact", "month", "poutcome",
]  # fmt: skip
DROP_COLS = ["day", "previous"]
if USE_DURATION:
    NUMERIC.append("duration")
else:
    DROP_COLS.append("duration")
FEATURES = NUMERIC + CATEGORICAL
FINAL_MODEL = "Gradient Boosting (Final)"


class IQRCapper(BaseEstimator, TransformerMixin):
    """Batasi nilai di atas ``Q3 + 1.5 * IQR``; batas dihitung hanya saat ``fit``.

    Parameters
    ----------
    columns : list of str
        Kolom yang dibatasi nilai atasnya.
    """

    def __init__(self, columns):
        self.columns = columns

    def fit(self, X, y=None):
        """Hitung batas atas dari data train."""
        X = pd.DataFrame(X)
        q1, q3 = X[self.columns].quantile(0.25), X[self.columns].quantile(0.75)
        self.upper_ = q3 + 1.5 * (q3 - q1)
        return self

    def transform(self, X):
        """Terapkan batas atas yang sudah dipelajari."""
        X = pd.DataFrame(X).copy()
        for col in self.columns:
            X[col] = X[col].clip(upper=self.upper_[col])
        return X

    def get_feature_names_out(self, input_features=None):
        """Nama kolom keluaran (sama dengan masukan)."""
        return np.asarray(input_features, dtype=object)


def clean_and_engineer(df):
    """Bersihkan nilai khusus dan tambah fitur turunan (tidak butuh statistik data).

    Parameters
    ----------
    df : pandas.DataFrame
        Data mentah nasabah.

    Returns
    -------
    pandas.DataFrame
        Data dengan "unknown" -> NaN, ``pdays=-1`` -> NaN, dan fitur
        ``contacted_before`` serta ``has_loan_any``.
    """
    df = df.copy()
    df[IMPUTE_UNKNOWN] = df[IMPUTE_UNKNOWN].replace("unknown", np.nan)
    df["pdays"] = df["pdays"].replace(-1, np.nan)
    df["contacted_before"] = df["pdays"].notna().astype(int)
    df["has_loan_any"] = ((df["housing"] == "yes") | (df["loan"] == "yes")).astype(int)
    return df


def load_data():
    """Muat data (jaga-jaga buang duplikat; file ini tidak punya), dan pisahkan fitur dari target."""
    df = pd.read_csv(DATA_PATH).drop_duplicates()
    df = clean_and_engineer(df)
    y = df["deposit"].map({"yes": 1, "no": 0})
    return df[FEATURES], y


def make_preprocessor():
    """Bangun ColumnTransformer: imputasi, capping, scaling, one-hot."""
    numeric_pipe = Pipeline(
        [
            ("impute", SimpleImputer(strategy="median").set_output(transform="pandas")),
            ("cap", IQRCapper(columns=["balance"])),
            ("scale", StandardScaler()),
        ]
    )
    categorical_pipe = Pipeline(
        [
            ("impute", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore")),
        ]
    )
    return ColumnTransformer(
        [("num", numeric_pipe, NUMERIC), ("cat", categorical_pipe, CATEGORICAL)]
    )


def make_models():
    """Kembalikan dict model: baseline, pembanding, dan model final."""
    estimators = {
        "Logistic Regression (Baseline)": LogisticRegression(
            random_state=RANDOM_STATE, max_iter=1000
        ),
        "Random Forest": RandomForestClassifier(
            random_state=RANDOM_STATE,
            n_estimators=200,
            n_jobs=-1,
            max_depth=10,
            min_samples_leaf=5,
        ),
        FINAL_MODEL: HistGradientBoostingClassifier(
            random_state=RANDOM_STATE,
            learning_rate=0.05,
            max_leaf_nodes=15,
            min_samples_leaf=40,
            l2_regularization=1.0,
            max_iter=200,
        ),
    }
    return {
        name: Pipeline([("prep", make_preprocessor()), ("model", est)])
        for name, est in estimators.items()
    }


def top_k_metrics(y_true, proba, frac=TOP_FRACTION):
    """Hitung capture rate, precision, dan lift jika hanya ``frac`` teratas ditelepon.

    Parameters
    ----------
    y_true : array-like of int
        Label sebenarnya (1 = deposit).
    proba : array-like of float
        Skor probabilitas model.
    frac : float, default=0.20
        Porsi nasabah dengan skor tertinggi yang ditelepon.

    Returns
    -------
    tuple of float
        ``(capture_rate, precision_top, lift)``.
    """
    y_true = np.asarray(y_true)
    n_top = int(len(y_true) * frac)
    hits = y_true[np.argsort(-np.asarray(proba))[:n_top]].sum()
    precision_top = hits / n_top
    return hits / y_true.sum(), precision_top, precision_top / y_true.mean()


def bootstrap_ci(y_true, proba, n_boot=1000, seed=RANDOM_STATE):
    """Interval kepercayaan 95% (bootstrap) untuk ROC-AUC dan precision Top 20%."""
    rng = np.random.default_rng(seed)
    y_true, proba = np.asarray(y_true), np.asarray(proba)
    aucs, tops = [], []
    for _ in range(n_boot):
        idx = rng.integers(0, len(y_true), len(y_true))
        aucs.append(roc_auc_score(y_true[idx], proba[idx]))
        tops.append(top_k_metrics(y_true[idx], proba[idx])[1])
    return np.percentile(aucs, [2.5, 97.5]), np.percentile(tops, [2.5, 97.5])


def evaluate(name, model, X_test, y_test):
    """Evaluasi satu model pada test set dan simpan confusion matrix-nya."""
    proba = model.predict_proba(X_test)[:, 1]
    pred = (proba >= 0.5).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_test, pred).ravel()
    capture, prec_top, lift = top_k_metrics(y_test, proba)
    auc_ci, top_ci = bootstrap_ci(y_test, proba)
    pct = int(TOP_FRACTION * 100)
    row = {
        "Model": name,
        "Precision": precision_score(y_test, pred),
        "Recall": recall_score(y_test, pred),
        "ROC-AUC": roc_auc_score(y_test, proba),
        "ROC-AUC 95% CI": f"{auc_ci[0]:.3f}-{auc_ci[1]:.3f}",
        f"Capture Top {pct}%": capture,
        f"Precision Top {pct}%": prec_top,
        f"Precision Top {pct}% 95% CI": f"{top_ci[0]:.3f}-{top_ci[1]:.3f}",
        f"Lift Top {pct}%": lift,
        "TP": tp, "FP": fp, "FN": fn, "TN": tn,
    }  # fmt: skip
    fig, ax = plt.subplots(figsize=(4, 3))
    sns.heatmap(
        [[tn, fp], [fn, tp]], annot=True, fmt="d", cmap="Blues", cbar=False,
        xticklabels=["No", "Yes"], yticklabels=["No", "Yes"], ax=ax,
    )  # fmt: skip
    ax.set(title=f"CM - {name}", xlabel="Predicted", ylabel="Actual")
    fig.tight_layout()
    fig.savefig(REPORT_DIR / f"cm_{name.split()[0].lower()}.png", dpi=150)
    plt.close(fig)
    return row


def plot_gain_curve(models, X_test, y_test):
    """Gambar kurva gain: % nasabah potensial tertangkap vs % nasabah yang ditelepon."""
    y = np.asarray(y_test)
    fig, ax = plt.subplots(figsize=(7, 5))
    colors = {"Logistic": "#4C72B0", "Random": "#DD8452", "Gradient": "#55A868"}
    for name, model in models.items():
        order = np.argsort(-model.predict_proba(X_test)[:, 1])
        gain = np.cumsum(y[order]) / y.sum()
        ax.plot(np.arange(1, len(y) + 1) / len(y), gain, label=name,
                color=colors[name.split()[0]], lw=2)  # fmt: skip
    ax.plot([0, 1], [0, 1], "--", color="grey", label="Acak (cold calling)")
    ax.axvline(TOP_FRACTION, color="black", lw=0.8, ls=":")
    ax.set(
        title="Kurva gain: semakin cepat naik, semakin efisien",
        xlabel="Proporsi nasabah yang ditelepon (urut skor tertinggi)",
        ylabel="Proporsi nasabah potensial yang tertangkap",
    )
    ax.legend(loc="lower right", frameon=False)
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    fig.savefig(REPORT_DIR / "gain_curve.png", dpi=150)
    plt.close(fig)


def plot_permutation_importance(model, X_test, y_test):
    """Hitung & gambar pentingnya tiap fitur asli (permutation importance, AUC)."""
    r = permutation_importance(model, X_test, y_test, scoring="roc_auc",
                               n_repeats=10, random_state=RANDOM_STATE, n_jobs=-1)  # fmt: skip
    imp = pd.Series(r.importances_mean, index=X_test.columns).nlargest(10)
    fig, ax = plt.subplots(figsize=(8, 5))
    sns.barplot(x=imp.values, y=imp.index, color="#55A868", ax=ax)
    ax.set(title="Top 10 fitur terpenting (penurunan ROC-AUC saat fitur diacak)",
           xlabel="Penurunan ROC-AUC")  # fmt: skip
    fig.tight_layout()
    fig.savefig(REPORT_DIR / "feature_importance.png", dpi=150)
    plt.close(fig)
    return imp


def find_threshold(model, X_train, y_train, target=TARGET_PRECISION):
    """Cari ambang skor terendah yang memberi precision >= ``target``.

    Memakai prediksi out-of-fold pada data train (bukan test) agar ambang
    tidak "mengintip" test set.
    """
    oof = cross_val_predict(model, X_train, y_train, cv=5, method="predict_proba")[:, 1]
    y = np.asarray(y_train)
    best = None
    for t in np.arange(0.40, 0.95, 0.01):
        sel = oof >= t
        if sel.sum() >= 50 and y[sel].mean() >= target:
            best = round(float(t), 2)
            break
    return best


def score_new_customers(model, threshold):
    """Contoh scoring: data mentah langsung masuk pipeline tanpa preprocessing manual."""
    new = pd.DataFrame(
        {
            "age": [35, 50], "job": ["management", "blue-collar"],
            "marital": ["married", "single"], "education": ["tertiary", "secondary"],
            "default": ["no", "no"], "balance": [8000.0, 100.0],
            "housing": ["no", "yes"], "loan": ["no", "yes"],
            "contact": ["cellular", "telephone"], "month": ["may", "feb"],
            "campaign": [1, 5], "pdays": [300, 50], "poutcome": ["success", "failure"],
        }
    )  # fmt: skip
    proba = model.predict_proba(clean_and_engineer(new)[FEATURES])[:, 1]
    out = new[["age", "balance"]].copy()
    out["Probability"] = proba
    out["Label"] = np.where(proba >= threshold, "Telepon (potensial)", "Lewati")
    return out


def main():
    """Latih, evaluasi, dan simpan laporan untuk semua model."""
    REPORT_DIR.mkdir(exist_ok=True)
    X, y = load_data()
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_STATE, stratify=y
    )
    print(f"Train: {X_train.shape}, Test: {X_test.shape}, USE_DURATION={USE_DURATION}")

    models = make_models()
    results = []
    for name, model in models.items():
        model.fit(X_train, y_train)
        results.append(evaluate(name, model, X_test, y_test))
    res = pd.DataFrame(results).set_index("Model")
    res.to_csv(REPORT_DIR / "metrics.csv")
    pd.set_option("display.width", 220)
    print("\n=== Hasil evaluasi (test set) ===")
    print(res.T)

    final = models[FINAL_MODEL]
    plot_gain_curve(models, X_test, y_test)
    print("\n=== Top 10 fitur (permutation importance) ===")
    print(plot_permutation_importance(final, X_test, y_test).round(4))

    thr = find_threshold(final, X_train, y_train)
    proba = final.predict_proba(X_test)[:, 1]
    sel = proba >= thr
    print(
        f"\n=== Ambang untuk target Precision >= {TARGET_PRECISION:.0%} (dari CV train) ==="
    )
    print(f"Ambang skor: {thr} | di test: precision={y_test[sel].mean():.3f}, "
          f"nasabah ditelepon={sel.mean():.1%}, capture={y_test[sel].sum() / y_test.sum():.1%}")  # fmt: skip
    print("\n=== Scoring data baru ===")
    print(score_new_customers(final, thr).round(4))


if __name__ == "__main__":
    main()
