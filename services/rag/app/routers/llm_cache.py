"""LLM response semantic cache endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, status
from loguru import logger
from pydantic import BaseModel, Field

from ..config import settings
from ..services.rag_service import rag_service

router = APIRouter(prefix="/api/v1/llm-cache", tags=["LLM Cache"])


class LlmCacheLookupRequest(BaseModel):
    agent_name: str = Field(..., description="Agent identifier")
    model: str = Field(..., description="Model identifier")
    user_message: str = Field(..., description="User message to look up")
    similarity_threshold: float | None = Field(
        None, description="Minimum cosine similarity (0.0-1.0), defaults to server config"
    )


class LlmCacheLookupResponse(BaseModel):
    hit: bool
    response_text: str | None = None
    provider: str | None = None
    usage: dict[str, Any] | None = None
    similarity: float | None = None


class LlmCacheStoreRequest(BaseModel):
    agent_name: str = Field(..., description="Agent identifier")
    model: str = Field(..., description="Model identifier")
    user_message: str = Field(..., description="Original user message")
    response_text: str = Field(..., description="LLM response to cache")
    provider: str | None = None
    usage: dict[str, Any] | None = None
    ttl_hours: int | None = None
    user_id: str | None = None
    organization_id: str | None = None


class LlmCacheStoreResponse(BaseModel):
    stored: bool


@router.post("/lookup", response_model=LlmCacheLookupResponse)
async def lookup(request: LlmCacheLookupRequest):
    """Look up a cached LLM response by semantic similarity."""
    if not rag_service.initialized:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RAG service not initialized",
        )

    cache = rag_service.llm_response_cache
    embedding_service = rag_service.embedding_service
    if not cache or not embedding_service:
        return LlmCacheLookupResponse(hit=False)

    try:
        embedding = await embedding_service.embed_query(request.user_message)
        entry = await cache.lookup(
            agent_name=request.agent_name,
            model=request.model,
            user_message_embedding=embedding,
            threshold=request.similarity_threshold or settings.llm_cache_similarity_threshold,
        )

        if entry is None:
            return LlmCacheLookupResponse(hit=False)

        logger.debug(
            "LLM cache hit: agent={} model={} similarity={:.3f}",
            request.agent_name,
            request.model,
            entry.similarity,
        )
        return LlmCacheLookupResponse(
            hit=True,
            response_text=entry.response_text,
            provider=entry.provider,
            usage=entry.usage,
            similarity=entry.similarity,
        )
    except Exception:
        logger.warning("LLM cache lookup endpoint failed", exc_info=True)
        return LlmCacheLookupResponse(hit=False)


@router.post("/store", response_model=LlmCacheStoreResponse)
async def store(request: LlmCacheStoreRequest):
    """Store an LLM response in the semantic cache."""
    if not rag_service.initialized:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RAG service not initialized",
        )

    cache = rag_service.llm_response_cache
    embedding_service = rag_service.embedding_service
    if not cache or not embedding_service:
        return LlmCacheStoreResponse(stored=False)

    try:
        embedding = await embedding_service.embed_query(request.user_message)
        await cache.store(
            agent_name=request.agent_name,
            model=request.model,
            user_message=request.user_message,
            embedding=embedding,
            response_text=request.response_text,
            provider=request.provider,
            usage=request.usage,
            ttl_hours=request.ttl_hours or settings.llm_cache_ttl_hours,
            user_id=request.user_id,
            organization_id=request.organization_id,
        )
        return LlmCacheStoreResponse(stored=True)
    except Exception:
        logger.warning("LLM cache store endpoint failed", exc_info=True)
        return LlmCacheStoreResponse(stored=False)
