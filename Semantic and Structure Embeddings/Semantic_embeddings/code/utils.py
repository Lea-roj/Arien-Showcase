from typing import Any, Dict, Iterable, List, Optional
import json
import numpy as np


def load_graph_json(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json_line(rows: Iterable[Dict[str, Any]], path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def aggregate_embeddings_from_chunks(embeddings: List[List[float]], how: str = "mean") -> List[float]:
    X = np.array(embeddings, dtype="float32")
    if how == "max":
        return X.max(axis=0).tolist()
    return X.mean(axis=0).tolist()


def apply_prompt_instruction(text: str, instruction: Optional[str], template: str) -> str:
    if not instruction:
        return text
    return template.format(instruction=instruction, text=text).strip()