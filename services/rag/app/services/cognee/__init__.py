"""Cognee service package for Tale RAG.

This package provides the CogneeService wrapper for cognee RAG operations.
"""

from typing import Any, Optional

from .config import initialize_cognee

# Initialize cognee environment and imports BEFORE importing the service
COGNEE_AVAILABLE = initialize_cognee()

if COGNEE_AVAILABLE:
    from .service import CogneeService

    # Global service instance
    cognee_service = CogneeService()
else:

    class _UnavailableCogneeService:
        """Null-object placeholder when cognee package is not available.

        This allows code to safely check `cognee_service.initialized` and call
        methods without crashing, while reporting degraded status.
        """

        initialized = False

        async def initialize(self) -> None:
            """No-op initialization when cognee is unavailable."""
            pass

        async def add_document(
            self,
            content: str,
            metadata: Optional[dict[str, Any]] = None,
            document_id: Optional[str] = None,
        ) -> dict[str, Any]:
            """Return failure response when cognee is unavailable."""
            return {
                "success": False,
                "document_id": document_id or "unknown",
                "chunks_created": 0,
                "error": "Cognee service is not available",
            }

        async def search(
            self,
            query: str,
            top_k: Optional[int] = None,
            similarity_threshold: Optional[float] = None,
            filters: Optional[dict[str, Any]] = None,
        ) -> list[dict[str, Any]]:
            """Return empty results when cognee is unavailable."""
            return []

        async def generate(
            self,
            query: str,
            top_k: Optional[int] = None,
            system_prompt: Optional[str] = None,
            temperature: Optional[float] = None,
            max_tokens: Optional[int] = None,
        ) -> dict[str, Any]:
            """Return failure response when cognee is unavailable."""
            return {
                "success": False,
                "response": "Cognee service is not available",
                "sources": [],
                "processing_time_ms": 0,
            }

        async def delete_document(self, document_id: str) -> dict[str, Any]:
            """Return failure response when cognee is unavailable."""
            return {
                "success": False,
                "message": "Cognee service is not available",
            }

    CogneeService = _UnavailableCogneeService  # type: ignore[misc,assignment]
    cognee_service = _UnavailableCogneeService()

__all__ = ["CogneeService", "cognee_service", "COGNEE_AVAILABLE"]

