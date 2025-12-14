"""Cognee service package for Tale RAG.

This package provides the CogneeService wrapper for cognee RAG operations.
"""

from .config import initialize_cognee

# Initialize cognee environment and imports BEFORE importing the service
COGNEE_AVAILABLE = initialize_cognee()

if COGNEE_AVAILABLE:
    from .service import CogneeService

    # Global service instance
    cognee_service = CogneeService()
else:
    # Provide a placeholder that will raise an error if used
    CogneeService = None  # type: ignore[assignment,misc]
    cognee_service = None  # type: ignore[assignment]

__all__ = ["CogneeService", "cognee_service", "COGNEE_AVAILABLE"]

