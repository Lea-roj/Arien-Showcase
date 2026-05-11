import time
from Semantic_embeddings.code.backends import PipelineConfig, which_embedding_engine_should_use
import json
import numpy as np
from typing import Dict, Any, List

GRAPH_IN = "enron_graph_labeled_poi.json"
GRAPH_OUT = "enron_graph_semantic.json"
GRAPH_TMP = "enron_graph_semantic.partial.json"

FAST_MODEL = "sentence-transformers/all-MiniLM-L12-v2"
BATCH_SIZE = 128
MAX_CHUNKS_PER_EMAIL = 4
CHUNK_SIZE = 2000
CHUNK_OVERLAP = 100
AGGREGATE = "mean"


def load_graph(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_graph(g: Dict[str, Any], path: str):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(g, f, indent=2, ensure_ascii=False)


def index_nodes(graph: Dict[str, Any]):
    nodes = graph.get("nodes", [])
    persons = {n["node_id"]: n for n in nodes if n.get("type") == "person"}
    emails = {n["node_id"]: n for n in nodes if n.get("type") == "email"}
    return persons, emails


def build_send_map(graph: Dict[str, Any]) -> Dict[int, List[int]]:
    m = {}
    for r in graph.get("relationships", []):
        if r.get("type") == "send":
            m.setdefault(r["src_id"], []).append(r["dst_id"])
    return m


class QuickChunker:
    def __init__(self, size=CHUNK_SIZE, overlap=CHUNK_OVERLAP, max_per_text=MAX_CHUNKS_PER_EMAIL, min_chars=3):
        self.size, self.overlap, self.max_per_text, self.min_chars = int(size), int(overlap), int(max_per_text), int(
            min_chars)

    def chunk_one_text(self, text: str) -> List[str]:
        text = (text or "").strip()
        if not text: return []
        size = max(1, self.size)
        ov = max(0, min(self.overlap, size - 1))
        stride = max(1, size - ov)
        out, i, n = [], 0, len(text)
        while i < n and len(out) < self.max_per_text:
            j = min(i + size, n)
            piece = text[i:j].strip()
            if len(piece) >= self.min_chars:
                out.append(piece)
            if j >= n: break
            i = i + stride
        return out


def serialize_email(node: Dict[str, Any], props_key="properties", max_chars=8000) -> str:
    p = node.get(props_key, {}) or {}
    subject = (p.get("subject") or "").strip()
    body = (p.get("body") or "").strip()
    if subject and body:
        txt = f"subject: {subject}\n\n{body}"
    else:
        txt = subject or body or ""
    return txt[:max_chars]


def agg(vecs: List[List[float]], how=AGGREGATE) -> List[float]:
    X = np.asarray(vecs, dtype="float32")
    return (X.max(axis=0) if how == "max" else X.mean(axis=0)).tolist()


def fast_embed_and_average(graph_in=GRAPH_IN, graph_out=GRAPH_OUT):
    graph = load_graph(graph_in)
    persons, emails = index_nodes(graph)
    send_map = build_send_map(graph)

    existing_email_vecs = {eid for eid, n in emails.items() if "sem_vec" in n.get("properties", {})}
    existing_person_vecs = {pid for pid, n in persons.items() if "sem_vec" in n.get("properties", {})}

    chunker = QuickChunker()
    email_ids = sorted(emails.keys())
    chunks, owners = [], []

    for eid in email_ids:
        if eid in existing_email_vecs:
            continue
        txt = serialize_email(emails[eid])
        parts = chunker.chunk_one_text(txt)
        if not parts:
            continue
        chunks.extend(parts)
        owners.extend([eid] * len(parts))

    print(f"emails (total): {len(email_ids)} | already embedded: {len(existing_email_vecs)}")
    print(f"emails to embed now: {len(set(owners))} | total chunks: {len(chunks)}")

    if not chunks and existing_email_vecs:
        print("Updating person vectors")
    else:
        fast_cfg = PipelineConfig(
            model_name=FAST_MODEL,
            backend="st",
            batch_size=BATCH_SIZE,
            chunk_size=CHUNK_SIZE,
            chunk_overlap=CHUNK_OVERLAP,
            aggregate=AGGREGATE,
            properties_key="properties",
            device="cuda",
        )
        backend = which_embedding_engine_should_use(
            backend=fast_cfg.backend, model_name=fast_cfg.model_name, device=fast_cfg.device, cfg=fast_cfg
        )

        if chunks:
            t0 = time.time()
            test = backend.embed(chunks[:min(8, len(chunks))], batch_size=min(8, BATCH_SIZE))
            dt = time.time() - t0
            print(f"smoke: {len(test)} vecs of dim {len(test[0]) if test else 'n/a'} in {dt:.2f}s")

        email_chunk_embs: List[List[float]] = []
        total, bs = len(chunks), BATCH_SIZE
        t_start = time.time()
        last_ckpt = time.time()

        for i in range(0, total, bs):
            batch = chunks[i:i + bs]
            embs = backend.embed(batch, batch_size=bs)
            email_chunk_embs.extend(embs)

            if (i // bs) % 20 == 0:
                done = min(i + bs, total)
                elapsed = time.time() - t_start
                rate = done / max(1e-6, elapsed)
                eta = (total - done) / max(1e-6, rate)
                print(f"[embed] {done}/{total} chunks | {rate:.1f}/s | ETA ~ {eta / 60:.1f} min")

            if time.time() - last_ckpt > 120:
                tmp_email_vecs = {}
                for vec, eid in zip(email_chunk_embs, owners[:len(email_chunk_embs)]):
                    tmp_email_vecs.setdefault(eid, []).append(vec)
                for eid, vecs in tmp_email_vecs.items():
                    emails[eid].setdefault("properties", {})["sem_vec"] = agg(vecs)
                save_graph(graph, GRAPH_TMP)
                last_ckpt = time.time()
                print(f"[checkpoint] wrote partial vectors to {GRAPH_TMP}")

        email_id_to_vecs: Dict[int, List[List[float]]] = {}
        for vec, eid in zip(email_chunk_embs, owners):
            email_id_to_vecs.setdefault(eid, []).append(vec)
        for eid, vecs in email_id_to_vecs.items():
            emails[eid].setdefault("properties", {})["sem_vec"] = agg(vecs)

    persons_updated = 0
    for pid, pnode in persons.items():
        sent = send_map.get(pid, [])
        vecs = [emails[eid]["properties"]["sem_vec"] for eid in sent
                if eid in emails and "sem_vec" in emails[eid].get("properties", {})]
        if vecs:
            pnode.setdefault("properties", {})["sem_vec"] = agg(vecs, "mean")
            persons_updated += 1

    save_graph(graph, graph_out)
    n_email = sum(1 for n in emails.values() if "sem_vec" in n.get("properties", {}))
    n_person = sum(1 for n in persons.values() if "sem_vec" in n.get("properties", {}))
    print(f"done: email vecs={n_email}, person vecs={n_person} --> {graph_out}")


fast_embed_and_average(
    graph_in="enron_graph_labeled_poi.json",
    graph_out="enron_graph_semantic.json"
)
