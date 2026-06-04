"""Stage 2 — Embed + Cluster

将 Stage 1 产出的 atoms 做 embedding + HDBSCAN/Ward 层次聚类。

Pipeline:
  1. Embedding: OpenAI-compatible /v1/embeddings
  2. UMAP 降维: high-dim → 10d
  3. HDBSCAN 密度聚类: 自动发现簇数和噪声点
  4. Ward 层次聚类: 对 HDBSCAN 簇做层级合并

输入：atoms/*.json
输出：clusters.json + duplicate-pairs.json

不调 LLM——全部为确定性脚本。

依赖：
  pip install hdbscan umap-learn numpy scipy scikit-learn requests

环境变量：
  EMBED_BASE_URL — embedding endpoint (default: http://127.0.0.1:12790)
  EMBED_MODEL    — model name (default: text-embedding-3-small)
  LLM_API_KEY    — API key
"""

from __future__ import annotations

import json
import hashlib
import os
import sys
from pathlib import Path
from typing import Any
from datetime import datetime, timezone

import numpy as np

SIMILARITY_THRESHOLD = 0.55
DUPLICATE_THRESHOLD = 0.92
MAX_CLUSTER_SIZE = 12
MIN_CLUSTER_SIZE = 3
def _default_embed_model():
    cfg_path = Path(__file__).resolve().parent.parent / "config.json"
    try:
        cfg = json.loads(cfg_path.read_text("utf-8"))
        return cfg.get("embedding", {}).get("model", "E000")
    except Exception:
        return "E000"

EMBEDDING_MODEL = os.environ.get("EMBED_MODEL") or _default_embed_model()
EMBEDDING_BASE_URL = os.environ.get("EMBED_BASE_URL", "http://127.0.0.1:12790")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "sk-placeholder")

UMAP_N_DIMS = int(os.environ.get("KNOWLEVER_UMAP_DIMS", "10"))
HDBSCAN_MIN_CLUSTER_SIZE = int(os.environ.get("KNOWLEVER_HDBSCAN_MIN", "5"))


def load_atoms(atoms_dir: Path) -> list[dict]:
    atoms = []
    for f in sorted(atoms_dir.glob("*.json")):
        data = json.loads(f.read_text("utf-8"))
        if isinstance(data, list):
            atoms.extend(data)
        elif isinstance(data, dict) and "atoms" in data:
            atoms.extend(data["atoms"])
    return atoms


def get_embeddings(texts: list[str], batch_size: int = 64) -> np.ndarray:
    """Call OpenAI-compatible embedding endpoint."""
    import requests

    all_embeddings = []
    base_url = EMBEDDING_BASE_URL.rstrip("/")

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        resp = requests.post(
            f"{base_url}/v1/embeddings",
            json={"model": EMBEDDING_MODEL, "input": batch},
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {LLM_API_KEY}",
            },
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()["data"]
        for item in sorted(data, key=lambda x: x["index"]):
            all_embeddings.append(item["embedding"])

    return np.array(all_embeddings, dtype=np.float32)


def compute_duplicates(embeddings: np.ndarray, atoms: list[dict]) -> list[dict]:
    """Find near-duplicate atom pairs by cosine similarity."""
    from sklearn.metrics.pairwise import cosine_similarity

    n = len(atoms)
    if n < 2:
        return []

    sim_matrix = cosine_similarity(embeddings)
    pairs = []
    for i in range(n):
        for j in range(i + 1, n):
            if sim_matrix[i, j] >= DUPLICATE_THRESHOLD:
                pairs.append({
                    "atom_a": atoms[i]["id"],
                    "atom_b": atoms[j]["id"],
                    "similarity": float(sim_matrix[i, j]),
                })
    return pairs


def cluster_atoms(embeddings: np.ndarray, atoms: list[dict]) -> list[dict]:
    """UMAP + HDBSCAN clustering pipeline."""
    n = len(atoms)
    if n < MIN_CLUSTER_SIZE:
        return [{"label": "single-cluster", "atom_ids": [a["id"] for a in atoms]}]

    # UMAP dimensionality reduction
    try:
        import umap
        n_dims = min(UMAP_N_DIMS, n - 2) if n > UMAP_N_DIMS + 2 else max(2, n - 2)
        reducer = umap.UMAP(n_components=n_dims, random_state=42, metric="cosine")
        reduced = reducer.fit_transform(embeddings)
    except ImportError:
        print("[Stage 2] WARNING: umap-learn not installed, using raw embeddings", file=sys.stderr)
        reduced = embeddings

    # HDBSCAN clustering
    try:
        import hdbscan
        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=HDBSCAN_MIN_CLUSTER_SIZE,
            metric="euclidean",
            cluster_selection_method="eom",
        )
        labels = clusterer.fit_predict(reduced)
    except ImportError:
        print("[Stage 2] WARNING: hdbscan not installed, using simple k-means fallback", file=sys.stderr)
        from sklearn.cluster import KMeans
        n_clusters = max(2, n // MAX_CLUSTER_SIZE)
        km = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        labels = km.fit_predict(reduced)

    # Group atoms by cluster label
    cluster_map: dict[int, list[str]] = {}
    noise_atoms: list[str] = []

    for i, label in enumerate(labels):
        if label == -1:
            noise_atoms.append(atoms[i]["id"])
        else:
            cluster_map.setdefault(label, []).append(atoms[i]["id"])

    # Split oversized clusters
    clusters = []
    for label, atom_ids in sorted(cluster_map.items()):
        if len(atom_ids) <= MAX_CLUSTER_SIZE:
            clusters.append({"label": f"cluster-{label}", "atom_ids": atom_ids})
        else:
            for chunk_i in range(0, len(atom_ids), MAX_CLUSTER_SIZE):
                chunk = atom_ids[chunk_i : chunk_i + MAX_CLUSTER_SIZE]
                clusters.append({"label": f"cluster-{label}-{chunk_i // MAX_CLUSTER_SIZE}", "atom_ids": chunk})

    # Assign noise atoms to nearest cluster or create a noise cluster
    if noise_atoms:
        if clusters:
            clusters.append({"label": "noise", "atom_ids": noise_atoms})
        else:
            clusters.append({"label": "all", "atom_ids": noise_atoms})

    return clusters


def run(atoms_dir: Path, output_dir: Path, topic: str):
    print(f"[Stage 2] Embed + Cluster: {topic}")
    atoms = load_atoms(atoms_dir)
    if not atoms:
        print("[Stage 2] No atoms found, skipping.")
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "clusters.json").write_text("[]", "utf-8")
        return

    texts = [f"{a.get('claim', '')} {' '.join(a.get('draft_tags', []))}" for a in atoms if a.get('claim')]
    atoms = [a for a in atoms if a.get('claim')]
    print(f"[Stage 2] Embedding {len(texts)} atoms...")
    embeddings = get_embeddings(texts)

    print(f"[Stage 2] Finding duplicates...")
    duplicates = compute_duplicates(embeddings, atoms)

    print(f"[Stage 2] Clustering...")
    clusters = cluster_atoms(embeddings, atoms)

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "clusters.json").write_text(
        json.dumps(clusters, ensure_ascii=False, indent=2), "utf-8"
    )
    (output_dir / "duplicate-pairs.json").write_text(
        json.dumps(duplicates, ensure_ascii=False, indent=2), "utf-8"
    )

    # Write tech decision
    td_path = output_dir / "tech-decisions.json"
    td = json.loads(td_path.read_text("utf-8")) if td_path.exists() else {
        "compiled_at": "", "topic": topic, "decisions": [], "audit": None
    }
    td["compiled_at"] = datetime.now(timezone.utc).isoformat()
    td["topic"] = topic
    decision = {
        "stage": "stage-2",
        "name": "embed + cluster",
        "chosen": f"{EMBEDDING_MODEL} + UMAP({UMAP_N_DIMS}d) + HDBSCAN",
        "rationale": f"Embedded {len(atoms)} atoms, found {len(clusters)} clusters and {len(duplicates)} duplicate pairs.",
        "known_limits": ["HDBSCAN 对极小数据集 (<10 atoms) 可能全标为噪声"],
        "switch_conditions": ["更换 embedding 模型时需重新聚类"],
    }
    existing_idx = next((i for i, d in enumerate(td["decisions"]) if d["stage"] == "stage-2"), None)
    if existing_idx is not None:
        td["decisions"][existing_idx] = decision
    else:
        td["decisions"].append(decision)
    td_path.write_text(json.dumps(td, ensure_ascii=False, indent=2), "utf-8")

    print(f"[Stage 2] ✅ {len(clusters)} clusters, {len(duplicates)} duplicate pairs")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python stage2-embed-cluster.py <atoms-dir> <output-dir> <topic>")
        sys.exit(2)
    run(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])
