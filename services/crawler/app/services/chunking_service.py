"""
Markdown-aware content chunking for search indexing.

Re-exports from the shared tale_knowledge package.
"""

from tale_knowledge.chunking import ContentChunk, chunk_content  # noqa: F401
from tale_knowledge.chunking.splitter import (  # noqa: F401
    CHUNK_OVERLAP,
    CHUNK_SIZE,
    MIN_CHUNK_LENGTH,
    build_metadata_prefix,
)
