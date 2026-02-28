"""
Markdown-aware content chunking for search indexing.

Re-exports from the shared tale_knowledge package.
"""

from tale_knowledge.chunking import ContentChunk, chunk_content  # noqa: F401
from tale_knowledge.chunking.splitter import CHUNK_OVERLAP, CHUNK_SIZE, MIN_CHUNK_LENGTH  # noqa: F401
