"""Pluggable vector-store backends for the RAG service.

The ANN index is abstracted behind `VectorStore`; Postgres remains the
source of truth for chunk content, metadata, and org isolation. See
`base.py` for the contract and the architecture rationale.
"""

from .base import VectorHit, VectorRecord, VectorStore
from .config_reader import VectorDbConfig, load_vectordb_config
from .external_pgvector_store import ExternalPgvectorStore
from .factory import get_vector_store
from .postgres_store import PostgresVectorStore

__all__ = [
    "ExternalPgvectorStore",
    "PostgresVectorStore",
    "VectorDbConfig",
    "VectorHit",
    "VectorRecord",
    "VectorStore",
    "get_vector_store",
    "load_vectordb_config",
]
