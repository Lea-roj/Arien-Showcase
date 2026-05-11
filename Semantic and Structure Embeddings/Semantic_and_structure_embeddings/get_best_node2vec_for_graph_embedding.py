import json

from Semantic_and_structure_embeddings.evaluate import evaluate_structure_embeddings
from Structure_embeddings.utils import train_node2vec, load_graph_from_json_directed


GRAPH = "11_small_graph.json"

G = load_graph_from_json_directed(GRAPH)

grid = []
for p in [0.5, 1, 2, 4]:
    for q in [0.25, 0.5, 1, 2]:
        ids, X = train_node2vec(G, dimensions=128, walk_length=60, num_walks=12,
                                window=10, p=p, q=q, workers=8, weight_key="weight",
                                negative=10, epochs=10, seed=42
                                )
        tmp = {str(ids[i]): X[i].tolist() for i in range(len(ids))}
        with open(f"tmp_n2v_p{p}_q{q}.json", "w") as f:
            json.dump(tmp, f)
        res = evaluate_structure_embeddings(G, f"tmp_n2v_p{p}_q{q}.json",
                                            test_frac=0.2, k_list=(5, 10, 20), seed=42)
        res.update({"p": p, "q": q})
        grid.append(res)
