"""
Search Router — Hybrid full-text + vector search across indexed website content.
"""

from fastapi import APIRouter, HTTPException
from loguru import logger

from app.models import SearchRequest, SearchResponse, SearchResultItem
from app.services.search_service import SearchService

router = APIRouter(prefix="/api/v1/search", tags=["Search"])

_search_service: SearchService | None = None


def set_search_service(service: SearchService) -> None:
    global _search_service
    _search_service = service


def _get_search_service() -> SearchService:
    if _search_service is None:
        raise HTTPException(status_code=503, detail="Search service not initialized")
    return _search_service


@router.post("", response_model=SearchResponse)
async def search_all(request: SearchRequest):
    """Search across all indexed website content."""
    try:
        service = _get_search_service()
        results = await service.search(query=request.query, limit=request.limit)
        return SearchResponse(
            query=request.query,
            results=[
                SearchResultItem(
                    url=r.url,
                    title=r.title,
                    chunk_content=r.chunk_content,
                    chunk_index=r.chunk_index,
                    score=r.score,
                )
                for r in results
            ],
            total=len(results),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Search failed")
        raise HTTPException(status_code=500, detail="Search failed") from None


@router.post("/{domain}", response_model=SearchResponse)
async def search_domain(domain: str, request: SearchRequest):
    """Search within a specific website's indexed content."""
    try:
        service = _get_search_service()
        results = await service.search(query=request.query, domain=domain, limit=request.limit)
        return SearchResponse(
            query=request.query,
            results=[
                SearchResultItem(
                    url=r.url,
                    title=r.title,
                    chunk_content=r.chunk_content,
                    chunk_index=r.chunk_index,
                    score=r.score,
                )
                for r in results
            ],
            total=len(results),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception(f"Search failed for domain {domain}")
        raise HTTPException(status_code=500, detail="Search failed") from None
