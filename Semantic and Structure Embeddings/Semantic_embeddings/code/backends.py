import os
from typing import List, Optional

import torch
from openai import OpenAI
import torch.nn as nn
import torch.nn.functional as F
from dataclasses import dataclass

from sentence_transformers import SentenceTransformer


@dataclass
class SerializationConfig:
    min_field_chars: int = 3  # Ignore small fields
    min_density: float = 0.25  # Skip if mostly whitespace/noise
    max_total_chars: int = 8000  # text per node
    key_value_format: bool = True  # Include "key: value" for context


@dataclass
class PipelineConfig:
    model_name: str = "all-mpnet-base-v2"
    backend: str = "st"  # st or openai
    batch_size: int = 64
    chunk_size: int = 1800
    chunk_overlap: int = 200
    aggregate: str = "mean"  # "mean" or "max"
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


class SentenceTransformersBackend:
    def __init__(self, model_name: str = "all-mpnet-base-v2", device="cuda"):
        self.device = device

        print(f"[INFO] Using device={self.device}")

        self.model = SentenceTransformer(model_name, device=self.device)

    def embed(self, texts: List[str], batch_size: int = 64) -> List[List[float]]:
        embs = self.model.encode(
            texts,
            batch_size=batch_size,
            show_progress_bar=True,
            normalize_embeddings=True,
            device=self.device
        )
        if hasattr(embs, "tolist"):
            return embs.tolist()
        return [list(x) for x in embs]


class OpenAIBackend:
    def __init__(self, model_name: str = "text-embedding-3-large"):
        self.client = OpenAI()
        self.model_name = model_name

    def embed(self, texts: List[str], batch_size: int = 256) -> List[List[float]]:
        out: List[List[float]] = []
        for i in range(0, len(texts), batch_size):
            chunk = texts[i:i + batch_size]
            resp = self.client.embeddings.create(model=self.model_name, input=chunk)
            out.extend([d.embedding for d in resp.data])
        return out


class TransformersLLMBackend:
    def __init__(
            self,
            model_name: str,
            device: str = "cuda",
            pooling: str = "mean",
            max_tokens: int = 512,
            normalize: bool = True,
            dtype: str = "auto",
            token: Optional[str] = None,
            trust_remote_code: bool = False,
    ):
        import torch
        from transformers import AutoModel, AutoTokenizer

        token_kwargs = {}
        if token is not None:
            token_kwargs = {"token": token}
        try:
            self.tokenizer = AutoTokenizer.from_pretrained(model_name, use_fast=True,
                                                           trust_remote_code=trust_remote_code, **token_kwargs)
        except TypeError:
            self.tokenizer = AutoTokenizer.from_pretrained(model_name, use_fast=True,
                                                           trust_remote_code=trust_remote_code,
                                                           use_auth_token=token)
        self.pooling = pooling
        self.max_tokens = max_tokens
        self.normalize = normalize

        if device is None:
            device = "cuda" if torch.cuda.is_available() else (
                "mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu"
            )
        self.device = device

        dtype_map = {
            "auto": None,
            "float16": torch.float16,
            "bfloat16": torch.bfloat16,
            "float32": torch.float32,
        }
        torch_dtype = dtype_map.get(dtype, None)

        self.model = AutoModel.from_pretrained(model_name, torch_dtype=torch_dtype, token=token,
                                               trust_remote_code=trust_remote_code).to(self.device)
        self.model.eval()

    def _pool(self, last_hidden, attention_mask, pooling: str):
        if pooling == "cls":
            return last_hidden[:, 0, :]
        mask = attention_mask.unsqueeze(-1).type_as(last_hidden)  # (B, T, 1)
        summed = (last_hidden * mask).sum(dim=1)
        counts = mask.sum(dim=1).clamp(min=1e-6)
        return summed / counts

    def embed(self, texts: List[str], batch_size: int = 8) -> List[List[float]]:
        import torch
        embs_out: List[List[float]] = []
        with torch.no_grad():
            for i in range(0, len(texts), batch_size):
                batch = texts[i:i + batch_size]
                enc = self.tokenizer(
                    batch,
                    return_tensors="pt",
                    padding=True,
                    truncation=True,
                    max_length=self.max_tokens,
                )
                enc = {k: v.to(self.device) for k, v in enc.items()}
                out = self.model(**enc)
                last_hidden = out.last_hidden_state  # (B, T, H)
                pooled = self._pool(last_hidden, enc["attention_mask"], self.pooling)  # (B, H)

                if self.normalize:
                    pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)

                embs_out.extend(pooled.detach().cpu().tolist())
        return embs_out


class ProjectionHead(nn.Module):
    def __init__(self, d_in: int, d_out: int = None, hidden: int = None, normalize: bool = True, learnable_scale: bool = True):
        super().__init__()

        if d_out is None:
            d_out = d_in

        self.normalize = normalize
        self.net = nn.Linear(d_in, d_out) if hidden is None else nn.Sequential(
            nn.Linear(d_in, hidden), nn.ReLU(), nn.Linear(hidden, d_out)
        )

        self.log_scale = nn.Parameter(torch.zeros(1)) if learnable_scale else None

    def forward(self, x):
        z = self.net(x)
        if self.normalize:
            z = F.normalize(z, p=2, dim=-1)
        if self.log_scale is not None:
            z = z * self.log_scale.exp()
        return z


def which_embedding_engine_should_use(backend: str, model_name: str, device: str, cfg: Optional[PipelineConfig] = None):
    if backend == "st":
        return SentenceTransformersBackend(model_name=model_name, device=device)
    elif backend == "openai":
        return OpenAIBackend(model_name=model_name)
    elif backend == "hf_llm":
        return TransformersLLMBackend(
            model_name=model_name,
            device=getattr(cfg, "device", None),
            pooling=getattr(cfg, "pooling", "mean"),
            max_tokens=getattr(cfg, "max_tokens", 512),
            normalize=getattr(cfg, "normalize", True),
            token=getattr(cfg, "token", None),
            trust_remote_code=getattr(cfg, "trust_remote_code", False),
        )
    else:
        raise ValueError(f"Unknown backend: {backend}")
