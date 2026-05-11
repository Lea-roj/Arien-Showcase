import json
import random
from pathlib import Path
from sklearn.metrics.pairwise import cosine_similarity
import networkx as nx
import numpy as np
from sklearn.metrics import roc_auc_score, average_precision_score


def coerce_id(x):
    if isinstance(x, str):
        try:
            return int(x)
        except Exception:
            return x
    return x


def load_embeddings_json(path):
    p = Path(path)
    ids, X = [], []
    if p.suffix == ".jsonl":
        for line in p.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            ids.append(coerce_id(r["id"]))
            X.append(r["embedding"])
    else:
        d = json.loads(p.read_text(encoding="utf-8"))
        for k in sorted(d.keys(), key=lambda z: str(z)):
            ids.append(coerce_id(k))
            X.append(d[k])

    X = np.asarray(X, dtype=np.float32)
    X /= (np.linalg.norm(X, axis=1, keepdims=True) + 1e-12)
    return np.array(ids, dtype=object), X


def make_index(ids):
    idx = {nid: i for i, nid in enumerate(ids)}
    for i, nid in enumerate(ids):
        s = str(nid)
        if s not in idx:
            idx[s] = i
    return idx


def to_simple_undirected(G):
    H = nx.Graph()
    H.add_nodes_from(G.nodes(data=True))
    if G.is_multigraph():
        for u, v, d in G.edges(data=True):
            w = float(d.get("weight", 1.0))
            if H.has_edge(u, v):
                H[u][v]["weight"] = H[u][v].get("weight", 0.0) + w
            else:
                H.add_edge(u, v, weight=w)
    else:
        for u, v, d in G.edges(data=True):
            if u == v:
                continue
            w = float(d.get("weight", 1.0))
            if H.has_edge(u, v):
                H[u][v]["weight"] += w
            else:
                H.add_edge(u, v, weight=w)
    return H


def train_test_split_edges(G, id_set, test_frac=0.2, seed=42):
    Gs = to_simple_undirected(G)
    keep = [n for n in Gs.nodes() if (n in id_set) or (str(n) in id_set)]
    H = Gs.subgraph(keep).copy()

    rng = random.Random(seed)
    edges = list(H.edges())
    rng.shuffle(edges)
    n_test = int(len(edges) * test_frac)

    test_pos = edges[:n_test]
    train_edges = edges[n_test:]

    T = nx.Graph()
    T.add_nodes_from(H.nodes(data=True))
    T.add_edges_from(train_edges)

    nodes = list(T.nodes())
    Eset = set(map(tuple, map(sorted, H.edges())))
    test_neg = set()
    while len(test_neg) < len(test_pos):
        u, v = rng.sample(nodes, 2)
        if u == v:
            continue
        e = tuple(sorted((u, v)))
        if e in Eset or e in test_neg:
            continue
        test_neg.add(e)

    return T, test_pos, list(test_neg)


def emb_score_pairs(ids, X, pairs):
    idx = make_index(ids)
    scores = []
    for u, v in pairs:
        iu = idx.get(u, idx.get(str(u)))
        iv = idx.get(v, idx.get(str(v)))
        if iu is None or iv is None:
            scores.append(0.0)
        else:
            scores.append(float(np.dot(X[iu], X[iv])))
    return np.array(scores, dtype=np.float32)


def heuristic_score_pairs(T, pairs, method="aa"):
    if method == "cn":
        lookup = {tuple(sorted((u, v))): s for u, v, s in nx.common_neighbor_centrality(T)}
    elif method == "jaccard":
        lookup = {tuple(sorted((u, v))): s for u, v, s in nx.jaccard_coefficient(T)}
    elif method == "aa":
        lookup = {tuple(sorted((u, v))): s for u, v, s in nx.adamic_adar_index(T)}
    else:
        raise ValueError("unknown method")
    return np.array([lookup.get(tuple(sorted((u, v))), 0.0) for u, v in pairs], dtype=np.float32)


def binary_ranking_metrics(pos_scores, neg_scores):
    y_true = np.array([1] * len(pos_scores) + [0] * len(neg_scores))
    y_score = np.concatenate([pos_scores, neg_scores])
    return float(roc_auc_score(y_true, y_score)), float(average_precision_score(y_true, y_score))


def hits_and_recall_at_k(ids, X, test_pos, k=10):
    idx = make_index(ids)
    N = len(ids)
    S = cosine_similarity(X)
    np.fill_diagonal(S, -1.0)
    hits, total = 0, 0
    for (u, v) in test_pos:
        iu = idx.get(u, idx.get(str(u)))
        iv = idx.get(v, idx.get(str(v)))
        if iu is None or iv is None:
            continue
        total += 1
        topk = np.argpartition(-S[iu], kth=min(k - 1, N - 1))[:k]
        if iv in topk:
            hits += 1
    return (hits / max(total, 1), total)
