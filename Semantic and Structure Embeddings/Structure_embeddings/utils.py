import networkx as nx
from gensim.models import Word2Vec
from matplotlib import pyplot as plt
from node2vec import Node2Vec
from sklearn.decomposition import PCA
import json
import numpy as np
import random


def generate_random_walks(graph, num_walks=10, walk_length=5):
    walks = []
    nodes = list(graph.nodes())

    for _ in range(num_walks):
        random.shuffle(nodes)
        for node in nodes:
            walk = perform_random_walk_from_a_given_start_node(graph, node, walk_length)
            walks.append(walk)

    return walks


def perform_random_walk_from_a_given_start_node(graph, start_node, walk_length):
    walk = [start_node]

    for _ in range(walk_length - 1):
        current_node = walk[-1]
        neighbors = list(graph.neighbors(current_node))

        if not neighbors:
            break

        next_node = random.choice(neighbors)
        walk.append(next_node)

    return walk


def train_deepwalk(graph, num_walks=10, walk_length=5, embedding_size=128, window_size=5, epochs=10):
    walks = generate_random_walks(graph, num_walks, walk_length)
    walks = [[str(node) for node in walk] for walk in walks]

    if not walks or all(len(w) == 0 for w in walks):
        return None

    model = Word2Vec(walks, vector_size=embedding_size, window=window_size, min_count=1, sg=1, workers=4, epochs=epochs)

    return model


def train_node2vec(G, dimensions=128, walk_length=60, num_walks=12, window=10,
                   p=1.0, q=0.5, workers=8, weight_key="weight", negative=10, epochs=10, seed=42):
    np.random.seed(seed)
    n2v = Node2Vec(G, dimensions=dimensions, walk_length=walk_length, num_walks=num_walks, p=p, q=q,
                   weight_key=weight_key, workers=workers, seed=seed)
    model = n2v.fit(window=window, min_count=1, batch_words=2048, sg=1, hs=0, negative=negative, epochs=epochs)
    ids = list(G.nodes())
    X = np.vstack([model.wv[str(n)] for n in ids])
    X = X / (np.linalg.norm(X, axis=1, keepdims=True) + 1e-12)

    return np.array(ids, dtype=object), X


embedding_methods = {
    "deepwalk": train_deepwalk,
    "node2vec": train_node2vec
}


def save_embeddings(embedding_dict, filename):
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(embedding_dict, f, indent=4)
    print(f"Saved embeddings to {filename}")


def load_graph_from_json_directed(file_path):
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    G = nx.MultiDiGraph()

    for n in data.get("nodes", []):
        nid = n.get("id")
        props = n.get("properties", {})
        if nid is not None:
            G.add_node(nid, **props)

    for rel in data.get("relationships", []):
        u = rel.get("from_id")
        v = rel.get("to_id")
        props = rel.get("properties", {})
        if u is not None and v is not None:
            G.add_edge(u, v, **props)
    return G


def compute_and_save_embedding(method_name, graph):
    if method_name in ["jaccard"]:
        embedding_methods[method_name](graph)

    if method_name == "deepwalk":
        model = train_deepwalk(graph, num_walks=10, walk_length=5, embedding_size=128)

        if model is None:
            return

        embeddings = {}
        for node in graph.nodes():
            node_str = str(node)
            if node_str in model.wv:
                embeddings[node_str] = model.wv[node_str].tolist()
            else:
                embeddings[node_str] = [0.0] * 128

        save_embeddings(embeddings, f"{method_name}_embeddings.json")

    elif method_name == "node2vec":
        ids, X = embedding_methods[method_name](graph, dimensions=128, walk_length=60, num_walks=12, p=1.0, q=0.5,
                                                window=10, workers=8, weight_key="weight", negative=10, epochs=10,
                                                seed=42)

        embeddings = {str(ids[i]): X[i].tolist() for i in range(len(ids))}

        save_embeddings(embeddings, "../GCN/uremovic/node2vec_embeddings.json")


def visualize_embeddings(embedding_file):
    with open(embedding_file, "r", encoding="utf-8") as f:
        embeddings = json.load(f)

    node_ids = list(embeddings.keys())
    emb_matrix = np.array([embeddings[nid] for nid in node_ids])

    pca = PCA(n_components=2)
    reduced = pca.fit_transform(emb_matrix)

    plt.figure(figsize=(6, 6))
    plt.scatter(
        reduced[:, 0], reduced[:, 1],
        c='yellow', s=5, alpha=0.5
    )
    plt.title(f"{embedding_file}")
    plt.grid(True)
    plt.tight_layout()
    plt.show()
