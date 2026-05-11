from __future__ import annotations
from typing import List, Tuple, Optional, Callable, Dict, Any
import re


# splits long texts into overlapping chunks and keeps track of which node each chunk belongs to
class Chunker:
    def __init__(self, chunk_size: int = 2000, chunk_overlap: int = 200,
                 encode: Optional[Callable[[str], List[int]]] = None,
                 decode: Optional[Callable[[List[int]], str]] = None,
                 token_chunk_size: Optional[int] = None,
                 token_chunk_overlap: Optional[int] = None,
                 min_chunk_chars: int = 20,
                 sentence_soft_boundary: bool = True,
                 max_chunks_per_text: Optional[int] = None,
                 per_chunk_instruction: Optional[str] = None):
        self.chunk_size = int(chunk_size)
        self.chunk_overlap = int(chunk_overlap)
        self.encode = encode
        self.decode = decode
        self.token_chunk_size = token_chunk_size
        self.token_chunk_overlap = token_chunk_overlap
        self.min_chunk_chars = int(min_chunk_chars)
        self.sentence_soft_boundary = sentence_soft_boundary
        self.max_chunks_per_text = max_chunks_per_text
        self.per_chunk_instruction = per_chunk_instruction

    def chunk(self, texts: List[str]) -> Tuple[List[str], List[int], List[Dict[str, Any]]]:
        chunked_texts: List[str] = []
        owners: List[int] = []
        meta: List[Dict[str, Any]] = []

        for idx, text in enumerate(texts):
            text = text or ""
            chunks, offsets = self._chunk_one(text)

            if self.per_chunk_instruction:
                chunks = [f"{self.per_chunk_instruction}\n{c}" for c in chunks]

            keep = []
            for j, c in enumerate(chunks):
                if len(c.strip()) >= self.min_chunk_chars:
                    keep.append(j)

            for k, j in enumerate(keep):
                chunked_texts.append(chunks[j])
                owners.append(idx)
                meta.append({
                    "owner": idx,
                    "chunk_idx": k,
                    "num_chunks": len(keep),
                    "start": offsets[j][0],
                    "end": offsets[j][1],
                    "mode": "token" if self._token_mode_enabled() else "char"
                })

        return chunked_texts, owners, meta

    def chunk_one_text(self, text: str) -> List[str]:
        chunks, _ = self._chunk_one(text or "")
        if self.per_chunk_instruction:
            chunks = [f"{self.per_chunk_instruction}\n{c}" for c in chunks]
        return [c for c in chunks if len(c.strip()) >= self.min_chunk_chars]

    def _token_mode_enabled(self) -> bool:
        return (self.encode is not None and
                self.decode is not None and
                self.token_chunk_size is not None and
                self.token_chunk_overlap is not None)

    def _chunk_one(self, text: str) -> Tuple[List[str], List[Tuple[int, int]]]:
        # TOKEN MODE CONFIGURED
        if self._token_mode_enabled():
            return self._token_chunks(text)
        # CHARACTER MODE
        return self._char_chunks(text)

    def _char_chunks(self, input_string: str) -> Tuple[List[str], List[Tuple[int, int]]]:
        if not input_string:
            return [], []
        size = max(1, int(self.chunk_size))
        overlap = max(0, int(self.chunk_overlap))
        if overlap >= size:
            overlap = size - 1
        stride = max(1, size - overlap)

        chunks, offsets = [], []
        i, n = 0, len(input_string)

        while i < n:
            j = min(i + size, n)
            piece = input_string[i:j]

            if self.sentence_soft_boundary and j < n:
                tail = piece[int(0.85 * len(piece)):]
                m = re.search(r'[.!?…](?:["\')\]]+)?(?=\s+\S)', tail)
                if m:
                    cut = int(0.85 * len(piece)) + m.end()
                    piece = piece[:cut]
                    j = i + cut

            chunks.append(piece)
            offsets.append((i, j))

            if j >= n:
                break
            i = i + stride

            if self.max_chunks_per_text is not None and len(chunks) >= self.max_chunks_per_text:
                break

        return chunks, offsets

    def _token_chunks(self, text: str) -> Tuple[List[str], List[Tuple[int, int]]]:
        ids = self.encode(text)

        if not ids:
            return [], []

        chunks: List[str] = []
        i = 0
        n = len(ids)

        size = int(self.token_chunk_size)
        overlap = int(self.token_chunk_overlap)
        if size <= 0:
            size = 1
        if overlap >= size:
            overlap = size - 1
        stride = max(1, size - overlap)

        offsets_tok: List[Tuple[int, int]] = []

        while i < n:
            j = min(i + size, n)
            sub_ids = ids[i:j]
            decoded = self.decode(sub_ids)
            chunks.append(decoded)
            offsets_tok.append((i, j))

            if j >= n:
                break
            i = i + stride

            if self.max_chunks_per_text is not None and len(chunks) >= self.max_chunks_per_text:
                break

        return chunks, offsets_tok
