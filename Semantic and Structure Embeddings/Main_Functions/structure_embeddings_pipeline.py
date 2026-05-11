import os
from Structure_embeddings.utils import load_graph_from_json_directed, compute_and_save_embedding

os.makedirs("structure_embeddings", exist_ok=True)

GRAPH = "datasets/enron_emails_graph_merged_people.json"
G = load_graph_from_json_directed(GRAPH)

compute_and_save_embedding("deepwalk", G)
compute_and_save_embedding("node2vec", G)
