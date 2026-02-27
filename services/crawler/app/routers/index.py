"""
Index Router — Content indexing management endpoints.
"""

from fastapi import APIRouter, HTTPException
from loguru import logger

from app.models import IndexPageRequest, IndexPageResponse, IndexWebsiteResponse
from app.services.indexing_service import IndexingService

router = APIRouter(prefix="/api/v1/index", tags=["Indexing"])

_indexing_service: IndexingService | None = None


def set_indexing_service(service: IndexingService) -> None:
    global _indexing_service
    _indexing_service = service


def _get_indexing_service() -> IndexingService:
    if _indexing_service is None:
        raise HTTPException(status_code=503, detail="Indexing service not initialized")
    return _indexing_service


@router.post("/page", response_model=IndexPageResponse)
async def index_page(request: IndexPageRequest):
    """Index a single page (chunk + embed + store)."""
    try:
        service = _get_indexing_service()
        result = await service.index_page(
            domain=request.domain,
            url=request.url,
            title=request.title,
            content=request.content,
        )
        return IndexPageResponse(
            success=result["status"] in ("indexed", "skipped"),
            url=result["url"],
            chunks_indexed=result["chunks_indexed"],
            status=result["status"],
            error=result.get("error"),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception(f"Indexing failed for {request.url}")
        raise HTTPException(status_code=500, detail="Indexing failed") from None


@router.post("/website/{domain}", response_model=IndexWebsiteResponse)
async def index_website(domain: str):
    """Re-index all pages for a website."""
    try:
        service = _get_indexing_service()
        result = await service.index_website(domain)
        return IndexWebsiteResponse(
            success=True,
            domain=result["domain"],
            pages_indexed=result["pages_indexed"],
            pages_skipped=result["pages_skipped"],
            pages_failed=result["pages_failed"],
            total_chunks=result["total_chunks"],
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception(f"Website indexing failed for {domain}")
        raise HTTPException(status_code=500, detail="Website indexing failed") from None
