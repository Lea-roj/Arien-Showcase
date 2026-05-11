from typing import Iterable, Sequence, Tuple, Optional, Dict, Any

import pandas as pd
from suspicious_node_detection.SEM_AND_STRUCT_EMBEDDINGS.utils import *
from suspicious_node_detection.STRUCTURE_EMBEDDINGS.utils import train_node2vec, load_graph_from_json_directed


def evaluate_structure_embeddings(G, emb_path, test_frac=0.2, k_list=(5, 10, 20), seed=42):
    ids, X = load_embeddings_json(emb_path)
    id_set = set(ids) | {str(i) for i in ids}
    T, pos, neg = train_test_split_edges(G, id_set, test_frac=test_frac, seed=seed)

    idx = make_index(ids)
    covered = sum(1 for (u, v) in pos if (idx.get(u) is not None) or (idx.get(str(u)) is not None))
    print(f"[{Path(emb_path).name}] test_pos={len(pos)} covered_nodes={covered*2}")

    pos_s = emb_score_pairs(ids, X, pos)
    neg_s = emb_score_pairs(ids, X, neg)
    emb_auc, emb_ap = binary_ranking_metrics(pos_s, neg_s)

    baselines = {}
    for name in ("cn", "jaccard", "aa"):
        p = heuristic_score_pairs(T, pos, name)
        n = heuristic_score_pairs(T, neg, name)
        a, ap = binary_ranking_metrics(p, n)
        baselines[f"{name}_auc"] = a
        baselines[f"{name}_ap"] = ap

    recalls = {}
    for k in k_list:
        r, tot = hits_and_recall_at_k(ids, X, pos, k=k)
        recalls[f"Recall@{k}"] = r

    return {
        "file": Path(emb_path).name,
        "test_edges": len(pos),
        "emb_auc": emb_auc,
        "emb_ap": emb_ap,
        **baselines,
        **recalls,
    }


def run_fused_dir_eval(G, fused_dir="fused", out_csv="fused_eval_summary.csv",
                       test_frac=0.2, k_list=(5,10,20), seed=42):
    fused_dir = Path(fused_dir)
    emb_paths = sorted([*fused_dir.glob("*.json"), *fused_dir.glob("*.jsonl")])
    if not emb_paths:
        raise FileNotFoundError(f"No .json/.jsonl files found in {fused_dir.resolve()}")

    results = []
    for p in emb_paths:
        try:
            res = evaluate_structure_embeddings(G, str(p), test_frac=test_frac,
                                                k_list=k_list, seed=seed)
            res["file"] = p.name
            results.append(res)
        except Exception as e:
            results.append({"file": p.name, "error": str(e)})

    df = pd.DataFrame(results)
    metric_rows = df[df.get("emb_auc").notna()] if "emb_auc" in df.columns else df.iloc[0:0]
    errors = df[df.get("error").notna()] if "error" in df.columns else df.iloc[0:0]

    if not metric_rows.empty:
        df_ranked = metric_rows.sort_values(by=["emb_auc","Recall@10"], ascending=[False, False])
        cols = [c for c in ["file","emb_auc","emb_ap","Recall@10","Recall@20"] if c in df_ranked.columns]
        print(df_ranked[cols])
        df_ranked.to_csv(out_csv, index=False)
        print(f"Saved: {out_csv}")

    return df


def eval_fixed_files(G, emb_files: Sequence[str], *, test_frac: float = 0.2, k_list: Tuple[int, ...] = (5, 10, 20), seed: int = 42) -> pd.DataFrame:
    rows = []
    for emb_path in emb_files:
        res = evaluate_structure_embeddings(G, emb_path, test_frac=test_frac, k_list=k_list, seed=seed)
        rows.append(res)
    return pd.DataFrame(rows).sort_values(by="emb_auc", ascending=False)


def test_for_p_q_node2vec_parameters(
    G,
    p_values: Iterable[float] = (0.5, 1, 2, 4),
    q_values: Iterable[float] = (0.25, 0.5, 1, 2),
    *, out_dir: str = "tmp_n2v", dims: int = 128, walk_length: int = 60, num_walks: int = 12,
    window: int = 10, negative: int = 10, epochs: int = 10, test_frac: float = 0.2,
    k_list: Tuple[int, ...] = (5, 10, 20), seed: int = 42,
) -> pd.DataFrame:
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    results = []

    for p in p_values:
        for q in q_values:
            ids, X = train_node2vec(
                G, dimensions=dims, walk_length=walk_length, num_walks=num_walks,
                window=window, p=p, q=q, workers=8, weight_key="weight",
                negative=negative, epochs=epochs, seed=seed
            )
            out_path = Path(out_dir) / f"tmp_n2v_p{p}_q{q}.json"
            with out_path.open("w", encoding="utf-8") as f:
                json.dump({str(ids[i]): X[i].tolist() for i in range(len(ids))}, f)

            res = evaluate_structure_embeddings(G, str(out_path), test_frac=test_frac, k_list=k_list, seed=seed)
            res.update({"p": p, "q": q, "path": str(out_path)})
            results.append(res)

    df = pd.DataFrame(results).sort_values(by=["emb_auc", "Recall@10"], ascending=[False, False])
    return df


def eval_dir(G, fused_dir: str = "fused", *, out_csv: Optional[str] = "fused_eval_summary.csv",
             test_frac: float = 0.2, k_list: Tuple[int, ...] = (5, 10, 20), seed: int = 42) -> pd.DataFrame:
    fused_path = Path(fused_dir)
    emb_paths = sorted([*fused_path.glob("*.json"), *fused_path.glob("*.jsonl")])
    if not emb_paths:
        raise FileNotFoundError(f"No .json/.jsonl files found in {fused_path.resolve()}")

    rows = []
    for p in emb_paths:
        try:
            res = evaluate_structure_embeddings(G, str(p), test_frac=test_frac, k_list=k_list, seed=seed)
            res["file"] = p.name
            rows.append(res)
        except Exception as e:
            rows.append({"file": p.name, "error": str(e)})

    df = pd.DataFrame(rows)

    if "emb_auc" in df.columns:
        metric_rows = df[df["emb_auc"].notna()]
    else:
        metric_rows = df.iloc[0:0]

    if not metric_rows.empty:
        df_ranked = metric_rows.sort_values(by=["emb_auc", "Recall@10"], ascending=[False, False])
        cols = [c for c in ["file", "emb_auc", "emb_ap", "Recall@10", "Recall@20"] if c in df_ranked.columns]
        print(df_ranked[cols])
        if out_csv:
            df_ranked.to_csv(out_csv, index=False)
            print(f"Saved: {out_csv}")

    return df

if __name__ == "__main__":
    GRAPH = "11_small_graph.json"
    G = load_graph_from_json_directed(GRAPH)

    df = eval_dir(
        G,
        fused_dir="fused",
        out_csv="small_graph_evaluate_fused.csv",
        test_frac=0.2,
        k_list=(10, 20),
        seed=42
    )
