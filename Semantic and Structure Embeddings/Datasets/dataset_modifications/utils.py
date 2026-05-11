import json, re, copy
from collections import defaultdict
from typing import Dict, Any

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")


def extract_all_emails(s: str) -> list[str]:
    return EMAIL_RE.findall(s or "")


def normalize_email(raw: str) -> str:
    s = (raw or "").strip().lower()

    s = re.sub(r"^e-?mail\s*<([^>]+)>\s*$", r"\1", s)

    s = s.strip("<>\"' \t")

    found = extract_all_emails(s)
    if found:
        s = found[0].lower()

    if "@" in s:
        local, dom = s.split("@", 1)
        local = re.sub(r"\.{2,}", ".", local)
        s = f"{local}@{dom}"

    return s


def merge_emails_sent(dst: dict, src: dict) -> dict:
    if not isinstance(dst, dict):
        dst = {}
    if not isinstance(src, dict):
        return dst

    for thread_id, messages in (src or {}).items():
        dst_messages = dst.setdefault(thread_id, {})
        if not isinstance(messages, dict):
            continue
        for date_key, mail in messages.items():
            if date_key not in dst_messages:
                dst_messages[date_key] = mail
            else:
                if dst_messages[date_key] != mail:
                    k = date_key
                    i = 2
                    while k in dst_messages:
                        k = f"{date_key} (dup {i})"
                        i += 1
                    dst_messages[k] = mail
    return dst


def coalesce_relationships(rels: list[dict]) -> list[dict]:
    bucket = {}
    for r in rels:
        props = r.get("properties", {}) or {}
        etype = props.get("type", "")
        key = (r.get("from_id"), r.get("to_id"), etype)

        num = float(props.get("number_of_emails_sent", 0) or 0)
        if key not in bucket:
            bucket[key] = copy.deepcopy(r)
            bucket[key]["properties"] = dict(props)
            bucket[key]["properties"]["number_of_emails_sent"] = num
        else:
            bucket[key]["properties"]["number_of_emails_sent"] += num

    out = []
    for (_, _, _), r in bucket.items():
        n = r["properties"].get("number_of_emails_sent", 0)
        if isinstance(n, float) and n.is_integer():
            r["properties"]["number_of_emails_sent"] = int(n)
        out.append(r)
    return out


def remove_duplicated_emails(INPUT_PATH, OUTPUT_PATH, RAW_GROUPS):
    alias_to_canonical: dict[str, str] = {}
    for aliases, keep in RAW_GROUPS:
        canon = normalize_email(keep)
        for a in aliases:
            for found in extract_all_emails(a) or [a]:
                alias_to_canonical[normalize_email(found)] = canon

    with open(INPUT_PATH, "r", encoding="utf-8") as f:
        graph = json.load(f)

    nodes = graph.get("nodes", [])
    rels = graph.get("relationships", [])

    email_to_node_ids = defaultdict(list)
    for n in nodes:
        props = n.get("properties", {}) or {}
        e = props.get("email")
        if e:
            email_to_node_ids[normalize_email(e)].append(n["id"])

    node_id_remap: dict[int, int] = {}
    canonical_node_ids: dict[str, int] = {}

    for alias, canon_email in alias_to_canonical.items():
        alias_ids = email_to_node_ids.get(alias, [])
        canon_ids = email_to_node_ids.get(canon_email, [])

        if canon_ids:
            survivor = canon_ids[0]
        elif alias_ids:
            survivor = alias_ids[0]
            canonical_node_ids[canon_email] = survivor
        else:
            continue

        for old in set(alias_ids + canon_ids):
            node_id_remap[old] = survivor
        canonical_node_ids.setdefault(canon_email, survivor)

    id_to_node = {n["id"]: n for n in nodes}
    to_remove_ids = set()
    for old_id, new_id in node_id_remap.items():
        if old_id == new_id:
            n = id_to_node.get(new_id)
            if not n:
                continue
            props = n.get("properties", {}) or {}
            current = normalize_email(props.get("email", ""))
            desired = None
            for alias, canon_email in alias_to_canonical.items():
                ids = email_to_node_ids.get(alias, []) + email_to_node_ids.get(canon_email, [])
                if old_id in ids:
                    desired = canon_email
                    break
            if desired and current != desired:
                props["email"] = desired
            n["properties"] = props
            continue

        n_old = id_to_node.get(old_id)
        n_new = id_to_node.get(new_id)
        if not n_old or not n_new:
            continue

        p_old = n_old.get("properties", {}) or {}
        p_new = n_new.get("properties", {}) or {}

        if not p_new.get("name") and p_old.get("name"):
            p_new["name"] = p_old["name"]

        p_new["emails_sent"] = merge_emails_sent(p_new.get("emails_sent", {}) or {}, p_old.get("emails_sent", {}) or {})

        n_new_count = int(p_new.get("number_of_emails_sent", 0) or 0)
        n_old_count = int(p_old.get("number_of_emails_sent", 0) or 0)
        p_new["number_of_emails_sent"] = n_new_count + n_old_count

        n_new["properties"] = p_new
        to_remove_ids.add(old_id)

    if to_remove_ids:
        nodes = [n for n in nodes if n["id"] not in to_remove_ids]
        graph["nodes"] = nodes

    for r in rels:
        if r["from_id"] in node_id_remap:
            r["from_id"] = node_id_remap[r["from_id"]]
        if r["to_id"] in node_id_remap:
            r["to_id"] = node_id_remap[r["to_id"]]

    rels = [r for r in rels if r.get("from_id") != r.get("to_id")]

    rels = coalesce_relationships(rels)
    graph["relationships"] = rels

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(graph, f, ensure_ascii=False, indent=2)


def remove_emails(INPUT_PATH, OUTPUT_PATH, EMAILS_TO_REMOVE):
    EMAILS_TO_REMOVE = {e.strip().lower() for e in EMAILS_TO_REMOVE if e.strip()}

    with open(INPUT_PATH, "r", encoding="utf-8") as f:
        graph = json.load(f)

    nodes = graph.get("nodes", [])
    rels = graph.get("relationships", [])

    to_remove_ids = set()
    for node in nodes:
        props = node.get("properties", {}) or {}
        email = props.get("email", "").strip().lower()
        ntype = props.get("type", "").lower()
        if ntype == "person" and email in EMAILS_TO_REMOVE:
            to_remove_ids.add(node["id"])

    nodes_cleaned = [n for n in nodes if n["id"] not in to_remove_ids]
    rels_cleaned = [
        r for r in rels
        if r.get("from_id") not in to_remove_ids and r.get("to_id") not in to_remove_ids
    ]

    graph["nodes"] = nodes_cleaned
    graph["relationships"] = rels_cleaned

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(graph, f, ensure_ascii=False, indent=2)


def count_emails_in_emails_sent(emails_sent: Dict[str, Any]) -> int:
    if not isinstance(emails_sent, dict):
        return 0
    total = 0
    for thread in emails_sent.values():
        if isinstance(thread, dict):
            total += sum(1 for _ in thread.items())
    return total


def remove_people_with_email_sent_empty(INPUT_PATH, OUTPUT_PATH):

    with open(INPUT_PATH, "r", encoding="utf-8") as f:
        graph = json.load(f)

    nodes = graph.get("nodes", [])
    rels = graph.get("relationships", [])

    to_remove_ids = set()
    for n in nodes:
        props = n.get("properties", {}) or {}
        if str(props.get("type", "")).lower() != "person":
            continue
        es = props.get("emails_sent", None)
        is_empty = (isinstance(es, dict) and len(es) == 0) or (es in (None, [], ""))
        if is_empty:
            to_remove_ids.add(n["id"])

    to_remove_ids_str = {str(i) for i in to_remove_ids}

    for n in nodes:
        if n["id"] in to_remove_ids:
            continue
        props = n.get("properties", {}) or {}
        es = props.get("emails_sent")
        if not isinstance(es, dict):
            continue

        changed = False
        for rid in list(es.keys()):
            if str(rid) in to_remove_ids_str:
                del es[rid]
                changed = True

        if changed:
            props["emails_sent"] = es
            props["number_of_emails_sent"] = count_emails_in_emails_sent(es)
            n["properties"] = props

    rels_clean = [
        r for r in rels
        if r.get("from_id") not in to_remove_ids and r.get("to_id") not in to_remove_ids
    ]
    graph["relationships"] = rels_clean

    nodes_clean = [n for n in nodes if n["id"] not in to_remove_ids]
    graph["nodes"] = nodes_clean

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(graph, f, ensure_ascii=False, indent=2)


def load_node_embeddings(INPUT):
    import json, numpy as np, matplotlib.pyplot as plt
    from sklearn.manifold import TSNE

    nodes, X = [], []
    with open(INPUT, "r", encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            nodes.append(row)
            X.append(row["embedding"])

    X = np.array(X)

    types = ["person" if "@" in n["text"] else "email" for n in nodes]
    colors = ["red" if t == "person" else "blue" for t in types]

    X_2d = TSNE(n_components=2, perplexity=30, random_state=42).fit_transform(X)

    plt.figure(figsize=(10, 8))
    plt.scatter(X_2d[:, 0], X_2d[:, 1], c=colors, s=12, alpha=0.7)
    plt.title("t-SNE: Semantic embeddings")
    plt.xlabel("dim 1")
    plt.ylabel("dim 2")
    plt.show()
