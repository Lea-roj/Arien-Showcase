from typing import Optional, List, Dict, Any

from Semantic_embeddings.code.backends import SerializationConfig, PipelineConfig
from Semantic_embeddings.code.utils import load_graph_json, save_json_line
from Semantic_embeddings.pipeline import get_embedding_for_node_text_attributes


def run_embedding_pipeline(path_to_graph_json: str, embedding_output_path: str,
                           embedding_model_name: str = "all-mpnet-base-v2",
                           backend: str = "st", batch_size: int = 64, chunk_size: int = 1800, chunk_overlap: int = 200,
                           aggregate: str = "mean", properties_key: str = "properties", key_value_format: bool = True,
                           instruction: Optional[str] = None, instruction_template: str = "{instruction}\n{text}",
                           pooling: str = "mean", max_tokens: int = 512, normalize: bool = True, device: str = "cuda",
                           **kwargs
                           ) -> List[Dict[str, Any]]:
    graph = load_graph_json(path_to_graph_json)

    """
    SerializationConfig:
        min_field_chars: int = 3            # Ignore small fields
        min_density: float = 0.25           # Skip if mostly whitespace/noise
        max_total_chars: int = 8000         # text per node
        key_value_format: bool = True       # Include "key: value" for context
    """
    ser_cfg = SerializationConfig(
        key_value_format=key_value_format
    )

    """
    PipelineConfig:
        model_name: str = "all-mpnet-base-v2"
        backend: str = "st"                 # st or openai
        batch_size: int = 64
        chunk_size: int = 1800
        chunk_overlap: int = 200
        aggregate: str = "mean"             # "mean" or "max"
        properties_key: str = "properties"

        # PROMPT INSTRUCTIONS
        instruction: Optional[str] = None
        instruction_template: str = "{instruction}\n{text}"

        # LLM as encoder
        pooling: str = "mean"
        max_tokens: int = 512
        normalize: bool = True
        device: str = "cuda"

        token: Optional[str] = None
        trust_remote_code: bool = False
    """
    pipe_cfg = PipelineConfig(
        model_name=embedding_model_name,
        backend=backend,
        batch_size=batch_size,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        aggregate=aggregate,
        properties_key=properties_key,
        instruction=instruction,
        instruction_template=instruction_template,
        pooling=pooling,
        max_tokens=max_tokens,
        normalize=normalize,
        device=device,
        **kwargs,
    )

    results = get_embedding_for_node_text_attributes(graph, cfg=pipe_cfg, serializer_cfg=ser_cfg)
    save_json_line(results, embedding_output_path)

    print(f"Wrote {len(results)} embeddings to {embedding_output_path}")
    return results


results = run_embedding_pipeline(
    path_to_graph_json="datasets/enron_emails_graph_merged_people.json",
    embedding_output_path="semantic_embeddings/enron_emails_graph_merged_people_all_mpnet_base_v2.jsonl",
    embedding_model_name="all-mpnet-base-v2",
    backend="st",
    device="cuda"
)
