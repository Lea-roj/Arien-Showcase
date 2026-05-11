from __future__ import annotations
import re
from typing import Dict, Any, List
import unicodedata
from Semantic_embeddings.code.backends import SerializationConfig, PipelineConfig


class TextSerializer:
    DEFAULT_EXCLUDE_KEYS = {
        "id", "uid", "uuid", "guid", "ssn", "password", "hash", "checksum",
        "lat", "lon", "lng", "latitude", "longitude",
        "x", "y", "z",
    }

    SUSPECT_LOW_VALUE_KEYS = {
        "timestamp", "time", "date", "datetime", "created_at", "updated_at",
        "message_id", "thread_id",
    }

    def __init__(self, serialization_cfg: SerializationConfig = SerializationConfig(),
                 pipeline_cfg: PipelineConfig = PipelineConfig()):
        self.serialization_cfg = serialization_cfg
        self.pipeline_cfg = pipeline_cfg

    """Return serialized text for a node."""

    def serialize_node(self, node: Dict[str, Any]) -> str:
        props_key = self.pipeline_cfg.properties_key
        cfg = self.serialization_cfg

        properties = node.get(props_key) or {}
        text_parts: List[str] = []

        for key in sorted(properties.keys()):
            if not self._should_keep_key(key):
                continue
            value = properties[key]

            strings = self.collect_string_like_values_from_JSON(value)

            filtered: List[str] = []
            for s in strings:
                norm = self._normalize_text(s)
                if len(norm) < cfg.min_field_chars:
                    continue
                if self._decide_if_string_looks_like_real_content(norm) < cfg.min_density:
                    continue
                filtered.append(norm)

            if not filtered:
                continue

            if cfg.key_value_format:
                if len(filtered) == 1:
                    text_parts.append(f"{key}: {filtered[0]}")
                else:
                    text_parts.append(f"{key}:\n- " + "\n- ".join(filtered))
            else:
                text_parts.extend(filtered)

        if not text_parts:
            loose = self.collect_string_like_values_from_JSON(properties)
            loose = [self._normalize_text(s) for s in loose if len(self._normalize_text(s)) >= cfg.min_field_chars]
            if loose:
                text_parts = loose

        text = "\n\n".join(text_parts)
        if len(text) > cfg.max_total_chars:
            text = text[: cfg.max_total_chars]

        text = self._apply_instruction(text, self.pipeline_cfg.instruction, self.pipeline_cfg.instruction_template)
        return text

    def serialize_graph(self, graph: Dict[str, Any]) -> List[Dict[str, Any]]:
        nodes = graph.get("nodes", [])
        results = []
        for node in nodes:
            node_id = node.get("id")
            text = self.serialize_node(node)
            results.append({"id": node_id, "text": text})
        return results

    def extract_texts(self, graph: Dict[str, Any]) -> List[str]:
        return [r["text"] for r in self.serialize_graph(graph)]

    def extract_mapping(self, graph: Dict[str, Any]) -> Dict[Any, str]:
        return {r["id"]: r["text"] for r in self.serialize_graph(graph)}

    def collect_string_like_values_from_JSON(self, value: Any) -> List[str]:
        list_of_string_attributes: List[str] = []
        if isinstance(value, str):
            list_of_string_attributes.append(value)
        elif isinstance(value, (list, tuple)):
            for v in value:
                list_of_string_attributes.extend(self.collect_string_like_values_from_JSON(v))
        elif isinstance(value, dict):
            str_vals = {k: v for k, v in value.items() if isinstance(v, str)}
            if str_vals and len(str_vals) == len(value) and sum(len(v) for v in str_vals.values()) <= 2000:
                list_of_string_attributes.append("; ".join(f"{k}: {v}" for k, v in str_vals.items()))
            else:
                for v in value.values():
                    list_of_string_attributes.extend(self.collect_string_like_values_from_JSON(v))
        else:
            pass

        return list_of_string_attributes

    @staticmethod
    def _normalize_text(s: str) -> str:
        s = unicodedata.normalize("NFKC", s)
        # Collapse runs of whitespace
        s = re.sub(r"[ \t\r\f\v]+", " ", s)
        # Normalize newlines
        s = re.sub(r"\n{3,}", "\n\n", s)
        return s.strip()

    @staticmethod
    def _decide_if_string_looks_like_real_content(s: str) -> float:
        if not s:
            return 0.0
        content = sum(ch.isalnum() or ch in ".,;:!?@#%&()[]{}<>/\\-_'\"+$*^~`|=+" for ch in s)
        return content / max(1, len(s))

    def _should_keep_key(self, key: str) -> bool:
        return key.lower() not in self.DEFAULT_EXCLUDE_KEYS

    @staticmethod
    def _apply_instruction(text: str, instruction: str | None, template: str) -> str:
        if not instruction:
            return text
        return template.format(instruction=instruction, text=text).strip()
