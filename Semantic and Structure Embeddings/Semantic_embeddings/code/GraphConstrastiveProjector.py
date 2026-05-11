from typing import Tuple, Optional, Dict, Any, List
import numpy as np
import torch
from Semantic_embeddings.code.backends import ProjectionHead
import torch.nn.functional as F


class GraphContrastiveProjector:
    def __init__(self,
                 edge_type_whitelist: Optional[Tuple[str, ...]] = None,  # None za all types, drugače pa send, received v tem primeru
                 edge_type_weights: Optional[Dict[str, float]] = None,
                 properties_key: str = "properties",
                 dim_out: Optional[int] = None, hidden: Optional[int] = None, batch_size: int = 1024,
                 epochs: int = 5, lr: float = 1e-3, temperature: float = 0.07,
                 device: str = "cuda" if torch.cuda.is_available() else "cpu"
                 ):

        self.edge_type_whitelist = edge_type_whitelist
        self.edge_type_weights = edge_type_weights or {}
        self.properties_key = properties_key
        self.dim_out = dim_out
        self.hidden = hidden
        self.batch_size = batch_size
        self.epochs = epochs
        self.lr = lr
        self.temperature = temperature
        self.device = device
        self.model = None

    def build_positive_pairs(self, graph: Dict[str, Any], list_of_embedding_rows: List[Dict[str, Any]]) \
            -> Tuple[np.ndarray, np.ndarray, Dict[str, int], np.ndarray, np.ndarray]:
        
        node_id_to_row_index_mapping = {str(r["id"]): i for i, r in enumerate(list_of_embedding_rows)}
        src, dst, wts = [], [], []

        for relationship in graph.get("relationships", []):
            props = relationship.get("properties", {}) or {}
            edge_type = str(props.get("type", ""))

            if self.edge_type_whitelist is not None and edge_type not in self.edge_type_whitelist:
                continue

            u, v = str(relationship["from_id"]), str(relationship["to_id"])
            
            if u == v:
                continue
                
            if u in node_id_to_row_index_mapping and v in node_id_to_row_index_mapping:
                src.append(node_id_to_row_index_mapping[u])
                dst.append(node_id_to_row_index_mapping[v])
                wts.append(float(self.edge_type_weights.get(edge_type, 1.0)))

        source_row_indices = np.asarray(src, dtype=np.int64)
        destination_row_indices = np.asarray(dst, dtype=np.int64)
        mask = np.ones_like(source_row_indices, dtype=np.int8)
        weights = np.asarray(wts, dtype=np.float32)

        return source_row_indices, destination_row_indices, node_id_to_row_index_mapping, mask, weights

    def nce_loss(self, z1, z2, weights: Optional[torch.Tensor] = None):
        """
        z1 ... projected embeddings of the batch’s sources
        z2 ... projected embeddings of the batch’s destinations

        Using cross-entropy, classify z1[i] as matching z2[i] (diagonalno), ostalo so negatives
        """
        logits = (z1 @ z2.t()) / self.temperature
        labels = torch.arange(z1.size(0), device=z1.device)

        loss_vec = F.cross_entropy(logits, labels, reduction="none")
        if weights is not None:
            loss = (loss_vec * weights).sum() / (weights.sum() + 1e-8)
        else:
            loss = loss_vec.mean()
        return loss

    def fit(self, frozen: np.ndarray, src_idx: np.ndarray, dst_idx: np.ndarray, weights_np: Optional[np.ndarray] = None):
        frozen = torch.from_numpy(frozen).float().to(self.device)
        d_in = frozen.shape[1]

        self.model = ProjectionHead(d_in, self.dim_out or d_in, self.hidden, normalize=True, learnable_scale=True).to(self.device)
        self.model.train()

        optimizer = torch.optim.AdamW(self.model.parameters(), lr=self.lr)

        num = int(src_idx.shape[0])

        if dst_idx.shape[0] != num:
            raise ValueError("not the same length")
        if weights_np is not None and len(weights_np) != num:
            raise ValueError("not the same length")

        idx = np.arange(num)
        w_all = torch.from_numpy(weights_np).float().to(self.device) if weights_np is not None else None

        use_amp = isinstance(self.device, str) and self.device.startswith("cuda")
        scaler = torch.cuda.amp.GradScaler(enabled=use_amp)

        for ep in range(self.epochs):
            np.random.shuffle(idx)
            total_loss = 0.0
            total_count = 0

            for i in range(0, num, self.batch_size):
                take = idx[i:i + self.batch_size]
                if take.size == 0:
                    continue

                s = torch.from_numpy(src_idx[take]).long().to(self.device)
                d = torch.from_numpy(dst_idx[take]).long().to(self.device)
                w = w_all[take] if w_all is not None else None

                optimizer.zero_grad(set_to_none=True)

                with torch.cuda.amp.autocast(enabled=use_amp):
                    z_s = self.model(frozen[s])
                    z_d = self.model(frozen[d])

                    loss_sd = self.nce_loss(z_s, z_d, w)
                    loss_ds = self.nce_loss(z_d, z_s, w)
                    loss = 0.5 * (loss_sd + loss_ds)

                scaler.scale(loss).backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
                scaler.step(optimizer)
                scaler.update()

                bs = z_s.size(0)
                total_loss += (loss.detach().item() * bs)
                total_count += bs

            avg = (total_loss / max(1, total_count))
            print(f"[ep {ep + 1}/{self.epochs}] loss={avg:.4f}")

        self.model.eval()
        return self

    @torch.no_grad()
    def project(self, X_in: np.ndarray) -> np.ndarray:
        assert self.model is not None, "Call fit(...) before project(...)."
        Xt = torch.from_numpy(X_in).float().to(self.device)
        Z = self.model(Xt).cpu().numpy()
        return Z
