import json
import re
import sys
from collections import defaultdict, Counter
from email.utils import getaddresses
from pathlib import Path
from typing import Optional, Tuple, List, Dict, Union

import matplotlib.pyplot as plt
import numpy as np
from sklearn.decomposition import PCA
from sklearn.manifold import TSNE


def build_person_graph_json_with_dates(input_path: str, output_path: str) -> None:
    raw = json.loads(Path(input_path).read_text(encoding="utf-8"))

    if isinstance(raw, dict) and "nodes" in raw and "relationships" in raw:
        g = raw
    elif isinstance(raw, list):
        person_id_by_email = {}
        person_props = {}
        next_pid = 0

        def get_or_make_person(email_addr, display_name=""):
            nonlocal next_pid
            if not email_addr:
                return None
            email_addr = email_addr.strip().lower()
            if not email_addr:
                return None
            if email_addr not in person_id_by_email:
                pid = next_pid
                next_pid += 1
                person_id_by_email[email_addr] = pid
                person_props[pid] = {"name": display_name or "", "email": email_addr}
            return person_id_by_email[email_addr]

        nodes = []
        rels = []
        email_nodes = []
        next_eid = 0

        for rec in raw:
            headers = rec.get("headers", {}) or {}
            body = rec.get("body", "") or ""

            from_display = headers.get("X-From") or ""
            from_email = (headers.get("From") or "").strip().lower()

            to_field = headers.get("To") or ""
            recipients = [addr.lower() for _, addr in getaddresses([to_field]) if addr]

            sid = get_or_make_person(from_email, from_display)
            if sid is None:
                continue

            rids = []
            for addr in recipients:
                rid = get_or_make_person(addr, "")
                if rid is not None:
                    rids.append(rid)
            if not rids:
                continue

            eid = next_eid
            next_eid += 1
            email_nodes.append(eid)

            email_node = {
                "id": eid,
                "properties": {
                    "type": "email",
                    "date": headers.get("Date") or "",
                    "subject": headers.get("Subject") or "",
                    "body": body,
                }
            }
            nodes.append(email_node)

            rels.append({
                "from_id": sid, "to_id": eid,
                "properties": {"type": "send"}
            })
            for rid in rids:
                rels.append({
                    "from_id": eid, "to_id": rid,
                    "properties": {"type": "received"}
                })

        for pid, info in person_props.items():
            nodes.append({
                "id": pid,
                "properties": {"type": "person", "name": info["name"], "email": info["email"]}
            })

        g = {"nodes": nodes, "relationships": rels}
    else:
        raise ValueError("Unrecognized JSON format")

    nodes = g.get("nodes", [])
    rels = g.get("relationships", [])

    persons = {}
    email_nodes = set()
    email_meta = {}

    for n in nodes:
        nid = n.get("id")
        props = n.get("properties", {}) or {}
        ntype = props.get("type", "")
        if ntype == "person":
            persons[nid] = {"email": props.get("email", "") or "",
                            "name": props.get("name", "") or ""}
        elif ntype == "email":
            email_nodes.add(nid)
            email_meta[nid] = {
                "date": props.get("date", "") or "",
                "subject": props.get("subject", "") or "",
                "body": props.get("body", "") or "",
            }

    senders_by_email = defaultdict(list)
    receivers_by_email = defaultdict(list)

    for e in rels:
        f = e.get("from_id")
        t = e.get("to_id")
        et = (e.get("properties") or {}).get("type", "")
        if et == "send" and f in persons and t in email_nodes:
            senders_by_email[t].append(f)
        elif et == "received" and f in email_nodes and t in persons:
            receivers_by_email[f].append(t)

    send_counts = Counter()
    emails_sent_map = defaultdict(lambda: defaultdict(dict))

    def _unique_date_key(existing_dict, date_str):
        if date_str == "" or date_str not in existing_dict:
            return date_str or "(no-date)"
        k = date_str
        i = 2
        while k in existing_dict:
            k = f"{date_str} ({i})"
            i += 1
        return k

    for eid in email_nodes:
        senders = senders_by_email.get(eid, [])
        receivers = receivers_by_email.get(eid, [])
        if not senders or not receivers:
            continue

        meta = email_meta.get(eid, {"date": "", "subject": "", "body": ""})
        date_str = meta.get("date", "") or ""
        subj = meta.get("subject", "") or ""
        body = meta.get("body", "") or ""

        for s in senders:
            for r in receivers:
                send_counts[(s, r)] += 1
                to_dict = emails_sent_map[s][r]
                dk = _unique_date_key(to_dict, date_str)
                to_dict[dk] = {"subject": subj, "body": body}

    total_sent_by_person = Counter()
    for (s, r), c in send_counts.items():
        total_sent_by_person[s] += c

    new_nodes = []
    for pid, info in persons.items():
        emails_sent_obj = {}
        for to_id, date_obj in emails_sent_map.get(pid, {}).items():
            emails_sent_obj[str(to_id)] = date_obj

        new_nodes.append({
            "id": int(pid),
            "properties": {
                "type": "person",
                "name": info["name"],
                "email": info["email"],
                "number_of_emails_sent": int(total_sent_by_person.get(pid, 0)),
                "emails_sent": emails_sent_obj,
            },
        })

    received_counts = Counter()
    for (s, r), c in send_counts.items():
        received_counts[(r, s)] += c

    new_rels = []
    for (s, r), c in sorted(send_counts.items()):
        new_rels.append({
            "from_id": int(s),
            "to_id": int(r),
            "properties": {
                "type": "send",
                "number_of_emails_sent": int(c),
            },
        })
    for (s, r), c in sorted(received_counts.items()):
        new_rels.append({
            "from_id": int(s),
            "to_id": int(r),
            "properties": {
                "type": "received",
                "number_of_emails_received": int(c),
            },
        })

    out = {"nodes": new_nodes, "relationships": new_rels}
    Path(output_path).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")


# build_person_graph_json_with_dates("../enron_emails.json", "enron_emails_graph.json")

def removeDuplicatedEmails(input_path="enron_emails_graph.json",
                           output_path="enron_emails_graph_removed_duplicates.json") -> None:
    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    total_removed = 0

    for node in data.get("nodes", []):
        props = node.get("properties", {})
        emails_sent = props.get("emails_sent", {})
        person_name = props.get("name", f"id={node.get('id')}")

        person_removed = 0
        new_email_count = 0

        for receiver_id, emails in emails_sent.items():
            seen_bodies = set()
            cleaned_emails = {}

            for email_key, email_content in emails.items():
                subj = email_content.get("subject", "").strip()
                body = email_content.get("body", "").strip()
                unique_key = (subj, body)

                if unique_key not in seen_bodies:
                    seen_bodies.add(unique_key)
                    cleaned_emails[email_key] = email_content
                else:
                    person_removed += 1

            new_email_count += len(cleaned_emails)
            emails_sent[receiver_id] = cleaned_emails

        props["number_of_emails_sent"] = new_email_count
        total_removed += person_removed

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"\nTotal duplicate emails removed: {total_removed}")


def visualize_semantic_embeddings_with_highlightedNodes(
        emb_json_path: str,
        graph_json_path: Optional[str] = None,
        sample_size: Optional[int] = None,
        tsne_perplexity: int = 30,
        umap_neighbors: int = 15,
        umap_min_dist: float = 0.1,
        random_state: int = 42,
        legend_max_classes: int = 15,
        highlight_ids: Optional[List[Union[int, str]]] = None,
        annotate_highlights: bool = True,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, List[str], np.ndarray]:
    ids, X = _load_embeddings(emb_json_path)
    N = len(ids)

    highlight_ids = [str(h) for h in (highlight_ids or [])]
    highlight_set = set(highlight_ids)

    colors = np.zeros(N, dtype=int)
    labels: List[str] = []
    legend_items: List[Tuple[int, str]] = []
    id2name: Dict[str, str] = {}

    if graph_json_path and Path(graph_json_path).exists():
        g = json.loads(Path(graph_json_path).read_text(encoding="utf-8"))
        id2type = {str(n["id"]): (n.get("properties") or {}).get("type", "") for n in g.get("nodes", [])}
        id2name = {str(n["id"]): (n.get("properties") or {}).get("name", "") for n in g.get("nodes", [])}
        labels = [id2type.get(i, "") for i in ids]

        counts = Counter(labels)
        sorted_types = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        keep = [t for t, _ in sorted_types[:legend_max_classes]]
        has_other = len(sorted_types) > legend_max_classes

        type_to_int: Dict[str, int] = {t: k for k, t in enumerate(keep)}
        other_idx = len(keep) if has_other else None
        colors = np.array([type_to_int.get(t, other_idx if has_other else 0) for t in labels], dtype=int)

        legend_items = [(type_to_int[t], f"{t} ({counts[t]})") for t in keep]
        if has_other:
            other_count = sum(c for t, c in sorted_types[legend_max_classes:])
            legend_items.append((other_idx, f"Other ({other_count})"))

        cmap = "tab10" if (len(legend_items) <= 10) else "tab20"
    else:
        cmap = "tab10"

    if sample_size is not None and sample_size < len(ids):
        rng = np.random.default_rng(random_state)
        all_idx = np.arange(len(ids))

        id2idx = {ids[i]: i for i in range(len(ids))}
        highlight_indices = [id2idx[i] for i in highlight_ids if i in id2idx]
        highlight_indices = np.array(sorted(set(highlight_indices)), dtype=int)

        remaining = np.setdiff1d(all_idx, highlight_indices, assume_unique=False)
        take_rest = max(0, sample_size - len(highlight_indices))
        if take_rest < 0:
            chosen_rest = np.array([], dtype=int)
        else:
            chosen_rest = rng.choice(remaining, size=take_rest, replace=False)

        take = np.concatenate([highlight_indices, chosen_rest]) if len(highlight_indices) > 0 else chosen_rest
        take.sort()

        ids = [ids[i] for i in take]
        X = X[take]
        colors = colors[take]
        if labels:
            labels = [labels[i] for i in take]

        id2idx = {ids[i]: i for i in range(len(ids))}
    else:
        id2idx = {ids[i]: i for i in range(len(ids))}

    pca = PCA(n_components=2, random_state=random_state)
    XY_pca = pca.fit_transform(X)

    tsne = TSNE(
        n_components=2,
        perplexity=min(tsne_perplexity, max(5, len(ids) // 3)),
        init="random",
        learning_rate="auto",
        random_state=random_state
    )
    XY_tsne = tsne.fit_transform(X)

    try:
        import umap
        um = umap.UMAP(
            n_neighbors=umap_neighbors,
            min_dist=umap_min_dist,
            metric="cosine",
            random_state=random_state,
        )
        XY_umap = um.fit_transform(X)
    except Exception:
        print("umap-learn not installed")
        XY_umap = XY_pca

    fig, axes = plt.subplots(1, 3, figsize=(18, 5))
    titles = ["PCA", "t-SNE", "UMAP"]
    for ax, XY, title in zip(axes, [XY_pca, XY_tsne, XY_umap], titles):
        ax.scatter(XY[:, 0], XY[:, 1], s=8, c=colors, alpha=0.75, cmap=cmap)
        ax.set_title(title)
        ax.set_xticks([])
        ax.set_yticks([])

        hi_indices = [id2idx[i] for i in highlight_ids if i in id2idx]
        if hi_indices:
            hi_indices = np.array(hi_indices, dtype=int)
            ax.scatter(
                XY[hi_indices, 0], XY[hi_indices, 1],
                s=120, facecolors="none", edgecolors="black", linewidths=2.0, zorder=5
            )
            ax.scatter(
                XY[hi_indices, 0], XY[hi_indices, 1],
                s=30, c="red", alpha=0.9, zorder=6
            )
            if annotate_highlights:
                for idx in hi_indices:
                    node_id = ids[idx]
                    label = id2name.get(node_id) or node_id
                    ax.annotate(label, (XY[idx, 0], XY[idx, 1]),
                                xytext=(5, 5), textcoords="offset points",
                                fontsize=9, weight="bold", color="black",
                                bbox=dict(boxstyle="round,pad=0.2", fc="white", ec="black", lw=0.5, alpha=0.7),
                                zorder=7)

    if legend_items:
        import matplotlib.lines as mlines
        handles = [
            mlines.Line2D([], [], linestyle="none", marker="o", markersize=6,
                          label=label, markerfacecolor=plt.cm.get_cmap(cmap)(idx / max(1, len(legend_items) - 1)))
            for idx, label in [(ci, lbl) for ci, lbl in legend_items]
        ]
        axes[-1].legend(handles=handles, loc="best", frameon=False, title="Node type")

    plt.tight_layout()
    plt.show()

    return XY_pca, XY_tsne, XY_umap, ids, colors


def _load_embeddings(path: Union[str, Path]) -> Tuple[List[str], np.ndarray]:
    p = Path(path)
    txt = p.read_text(encoding="utf-8")

    ids: List[str] = []
    vecs: List[List[float]] = []
    lines = [ln for ln in txt.splitlines() if ln.strip()]
    parsed_lines = []
    is_jsonl = False
    try:
        for ln in lines:
            parsed_lines.append(json.loads(ln))
        if parsed_lines and all(isinstance(r, dict) and "embedding" in r for r in parsed_lines):
            is_jsonl = True
    except Exception:
        is_jsonl = False

    if is_jsonl:
        for r in parsed_lines:
            ids.append(str(r.get("id")))
            vecs.append(r["embedding"])
        return ids, np.array(vecs, dtype=np.float32)

    obj = json.loads(txt)
    if isinstance(obj, dict):
        ids = list(obj.keys())
        vecs = [obj[k]["embedding"] for k in ids]
        return ids, np.array(vecs, dtype=np.float32)

    raise ValueError(f"Unrecognized embedding file format: {path}")


def visualize_semantic_embeddings(
        emb_json_path: str,
        graph_json_path: Optional[str] = None,
        sample_size: Optional[int] = None,
        tsne_perplexity: int = 30,
        umap_neighbors: int = 15,
        umap_min_dist: float = 0.1,
        random_state: int = 42,
        legend_max_classes: int = 15,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, List[str], np.ndarray]:
    ids, X = _load_embeddings(emb_json_path)
    N = len(ids)

    colors = np.zeros(N, dtype=int)
    labels: List[str] = []
    legend_items: List[Tuple[int, str]] = []

    if graph_json_path and Path(graph_json_path).exists():
        g = json.loads(Path(graph_json_path).read_text(encoding="utf-8"))
        id2type = {str(n["id"]): (n.get("properties") or {}).get("type", "") for n in g.get("nodes", [])}
        labels = [id2type.get(i, "") for i in ids]

        counts = Counter(labels)
        sorted_types = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        keep = [t for t, _ in sorted_types[:legend_max_classes]]
        has_other = len(sorted_types) > legend_max_classes

        type_to_int: Dict[str, int] = {t: k for k, t in enumerate(keep)}
        other_idx = len(keep) if has_other else None
        colors = np.array([type_to_int.get(t, other_idx if has_other else 0) for t in labels], dtype=int)

        legend_items = [(type_to_int[t], f"{t} ({counts[t]})") for t in keep]
        if has_other:
            other_count = sum(c for t, c in sorted_types[legend_max_classes:])
            legend_items.append((other_idx, f"Other ({other_count})"))

        cmap = "tab10" if (len(legend_items) <= 10) else "tab20"
    else:
        cmap = "tab10"

    if sample_size is not None and sample_size < len(ids):
        rng = np.random.default_rng(random_state)
        take = rng.choice(len(ids), size=sample_size, replace=False)
        ids = [ids[i] for i in take]
        X = X[take]
        colors = colors[take]
        if labels:
            labels = [labels[i] for i in take]

    pca = PCA(n_components=2, random_state=random_state)
    XY_pca = pca.fit_transform(X)

    tsne = TSNE(
        n_components=2,
        perplexity=min(tsne_perplexity, max(5, len(ids) // 3)),
        init="random",
        learning_rate="auto",
        random_state=random_state
    )
    XY_tsne = tsne.fit_transform(X)

    try:
        import umap
        um = umap.UMAP(
            n_neighbors=umap_neighbors,
            min_dist=umap_min_dist,
            metric="cosine",
            random_state=random_state,
        )
        XY_umap = um.fit_transform(X)
    except Exception:
        print("umap-learn not installed")
        XY_umap = XY_pca

    fig, axes = plt.subplots(1, 3, figsize=(18, 5))
    titles = ["PCA", "t-SNE", "UMAP"]
    for ax, XY, title in zip(axes, [XY_pca, XY_tsne, XY_umap], titles):
        sc = ax.scatter(XY[:, 0], XY[:, 1], s=8, c=colors, alpha=0.75, cmap=cmap)
        ax.set_title(title)
        ax.set_xticks([])
        ax.set_yticks([])

    if legend_items:
        import matplotlib.lines as mlines
        handles = [
            mlines.Line2D([], [], linestyle="none", marker="o", markersize=6,
                          label=label, markerfacecolor=plt.cm.get_cmap(cmap)(idx / max(1, len(legend_items) - 1)))
            for idx, label in [(ci, lbl) for ci, lbl in legend_items]
        ]
        axes[-1].legend(handles=handles, loc="best", frameon=False, title="Node type")

    plt.tight_layout()
    plt.show()

    return XY_pca, XY_tsne, XY_umap, ids, colors
