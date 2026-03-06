"""Search and generation endpoints for Tale RAG service."""

import time

from fastapi import APIRouter, HTTPException, status
from loguru import logger

from ..models import (
    GenerateRequest,
    GenerateResponse,
    QueryRequest,
    QueryResponse,
    SearchResult,
)
from ..services.rag_service import rag_service

router = APIRouter(prefix="/api/v1", tags=["Search"])


@router.post("/search", response_model=QueryResponse)
async def search(request: QueryRequest):
    """Search the knowledge base using hybrid BM25 + vector search."""
    try:
        start_time = time.time()

        results = await rag_service.search(
            query=request.query,
            top_k=request.top_k,
            similarity_threshold=request.similarity_threshold,
            user_id=request.user_id,
            document_ids=request.document_ids,
        )

        processing_time = (time.time() - start_time) * 1000

        search_results = [
            SearchResult(
                content=r.get("content", ""),
                score=r.get("score", 0.0),
                document_id=r.get("document_id"),
                metadata=r.get("metadata") if request.include_metadata else None,
            )
            for r in results
        ]

        return QueryResponse(
            success=True,
            query=request.query,
            results=search_results,
            total_results=len(search_results),
            processing_time_ms=processing_time,
        )

    except Exception as e:
        logger.exception("Search failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Search failed. Please try again.",
        ) from e


@router.post("/generate", response_model=GenerateResponse)
async def generate(request: GenerateRequest):
    """Generate a response using RAG.

    Retrieves top 30 most relevant chunks, uses temperature 0.3
    for factual, consistent responses, and generates up to 2000 tokens.
    """
    try:
        result = await rag_service.generate(
            query=request.query,
            user_id=request.user_id,
            document_ids=request.document_ids,
        )

        sources = [
            SearchResult(
                content=s.get("content", ""),
                score=s.get("score", 0.0),
                document_id=s.get("document_id"),
                metadata=s.get("metadata"),
            )
            for s in result.get("sources", [])
        ]

        return GenerateResponse(
            success=result.get("success", False),
            query=request.query,
            response=result.get("response", ""),
            sources=sources,
            processing_time_ms=result.get("processing_time_ms", 0),
        )

    except Exception as e:
        logger.exception("Generation failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate response. Please try again.",
        ) from e
