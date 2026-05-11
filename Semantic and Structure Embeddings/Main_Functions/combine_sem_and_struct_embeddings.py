from pathlib import Path

from Semantic_and_structure_embeddings.combine_sem_and_struct import fuse_all

if __name__ == "__main__":
    sem_dir = Path("semantic_embeddings")
    sem_files = sorted(str(p) for p in sem_dir.glob("*.jsonl"))

    n2v_path = "structure_embeddings"
    alphas = [0.35, 0.50, 0.65]

    fuse_all(
        sem_files, n2v_path, alphas,
        out_dir="fused",
        mode="concat",  # "pca_sum" or "concat
        target_dim=256,
        balance_by_dim=True,
        evaluator=None,
    )
