import json
from pathlib import Path
from typing import Iterable, Callable, Optional, List

import numpy as np
from sklearn.decomposition import PCA


def _load_any(path: str) -> dict[str, np.ndarray]:
    p = Path(path)
    D: dict[str, np.ndarray] = {}
    if p.suffix == ".jsonl":
        for line in p.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            D[str(r["id"])] = np.array(r["embedding"], dtype=np.float32)
    else:
        raw = json.loads(p.read_text(encoding="utf-8"))
        for k, v in raw.items():
            D[str(k)] = np.array(v, dtype=np.float32)
    return D


def _l2n(X: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(X, axis=1, keepdims=True) + 1e-12
    return X / n


def _dict_to_matrix(D: dict[str, np.ndarray], ids: list[str]) -> np.ndarray:
    return np.stack([D[i] for i in ids], axis=0)


def fuse_embeddings(
        sem_path: str,
        n2v_path: str,
        out_path: str,
        *,
        alpha: float = 0.5,
        mode: str = "concat",
        target_dim: Optional[int] = 256,  # for mode="pca_sum"
        balance_by_dim: bool = True,
) -> str:
    SEM = _load_any(sem_path)
    N2V = _load_any(n2v_path)

    ids = sorted(set(SEM.keys()) & set(N2V.keys()))
    if not ids:
        raise ValueError("No overlapping node IDs between semantic and node2vec files.")

    Xs = _dict_to_matrix(SEM, ids)
    Xg = _dict_to_matrix(N2V, ids)
    Xs = _l2n(Xs)
    Xg = _l2n(Xg)

    if mode == "concat":
        if balance_by_dim:
            Xs = Xs * (1.0 / np.sqrt(Xs.shape[1]))
            Xg = Xg * (1.0 / np.sqrt(Xg.shape[1]))
        Z = np.concatenate([alpha * Xs, (1 - alpha) * Xg], axis=1)
        Z = _l2n(Z)
    elif mode == "pca_sum":
        if target_dim is None:
            raise ValueError("target_dim must be set for mode='pca_sum'")
        S = PCA(n_components=target_dim, random_state=42).fit_transform(Xs)
        G = PCA(n_components=target_dim, random_state=42).fit_transform(Xg)
        S = _l2n(S)
        G = _l2n(G)
        Z = _l2n(alpha * S + (1 - alpha) * G)
    else:
        raise ValueError("'concat' or 'pca_sum'")

    out = {ids[i]: Z[i].tolist() for i in range(len(ids))}
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f)
    print(f"Fused {len(ids)} nodes --> {out_path}  (mode={mode}, alpha={alpha})")
    return out_path


def fuse_all(
        sem_files: Iterable[str],
        n2v_path: str,
        alphas: Iterable[float],
        *,
        out_dir: str = "fused",
        mode: str = "concat",
        target_dim: Optional[int] = 256,
        balance_by_dim: bool = True,
        evaluator: Optional[Callable[[str], dict]] = None,
) -> List[str]:
    out_paths: List[str] = []
    out_dir_p = Path(out_dir)
    out_dir_p.mkdir(parents=True, exist_ok=True)

    for sem in sem_files:
        name = Path(sem).stem
        for a in alphas:
            out = out_dir_p / f"{name}__n2v_{mode}_a{a:.2f}.json"
            fuse_embeddings(
                sem, n2v_path, str(out),
                alpha=a, mode=mode, target_dim=target_dim, balance_by_dim=balance_by_dim
            )
            out_paths.append(str(out))
            if evaluator is not None:
                try:
                    metrics = evaluator(str(out))
                    print(f"[EVAL] {out.name} → {metrics}")
                except Exception as e:
                    print(f"[EVAL] {out.name} failed: {e}")
    return out_paths