from __future__ import annotations

from Semantic_embeddings.code.Chunker import Chunker
from Semantic_embeddings.code.TextSerializer import TextSerializer
from Semantic_embeddings.code.utils import *
from Semantic_embeddings.code.backends import *


def get_embedding_for_node_text_attributes(
        graph: Dict[str, Any],
        cfg: PipelineConfig = PipelineConfig(),
        serializer_cfg: SerializationConfig = SerializationConfig()) -> List[Dict[str, Any]
]:
    # 1) GET TEXT ATTRIBUTES FROM GRAPH NODES
    serializer = TextSerializer(serializer_cfg, cfg)
    serialized_rows = serializer.serialize_graph(graph)
    texts = [r["text"] for r in serialized_rows]
    node_ids = [r["id"] for r in serialized_rows]

    # 2) CHUNKER
    chunker = Chunker(cfg.chunk_size, cfg.chunk_overlap)
    chunked_texts, owners, _meta = chunker.chunk(texts)

    # 3) EMBEDDINGS
    embedding_engine = which_embedding_engine_should_use(cfg.backend, cfg.model_name, cfg.device, cfg)
    embeddings = embedding_engine.embed(chunked_texts, batch_size=cfg.batch_size)

    # 4) GROUP PER NODE + AGGREGATE
    per_node_embeddings: Dict[int, List[List[float]]] = {}
    for owner, emb in zip(owners, embeddings):
        per_node_embeddings.setdefault(owner, []).append(emb)

    results: List[Dict[str, Any]] = []
    dim = len(embeddings[0]) if embeddings else 768
    zero = [0.0] * dim

    for idx, node_id in enumerate(node_ids):
        chunks = per_node_embeddings.get(idx, [])
        if chunks:
            agg = aggregate_embeddings_from_chunks(chunks, how=cfg.aggregate)
        else:
            agg = zero
        results.append({"id": node_id, "text": texts[idx], "embedding": agg})

    return results