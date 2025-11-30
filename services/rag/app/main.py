"""Main FastAPI application for Tale RAG service."""

import gc
import json
import logging
import os
import tempfile
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException, Request, status, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.background import BackgroundTasks
from loguru import logger
from uuid import uuid4

from . import __version__
from .config import settings
from .models import (
    HealthResponse,
    ConfigResponse,
    DocumentAddRequest,
    DocumentAddResponse,
    DocumentDeleteRequest,
    DocumentDeleteResponse,
    QueryRequest,
    QueryResponse,
    GenerateRequest,
    GenerateResponse,
    BatchAddRequest,
    BatchAddResponse,
    SearchResult,
    ErrorResponse,
    JobStatus,
)
from .services.cognee_service import cognee_service
from .services import job_store


# Optional memory debug logging (disabled by default; enable with RAG_DEBUG_MEMORY=1)
_DEBUG_MEMORY = os.getenv("RAG_DEBUG_MEMORY", "").lower() in ("1", "true", "yes")


def _log_memory_snapshot(context: str) -> None:
    """Log current RSS in MiB when debug memory logging is enabled.

    This reads /proc/self/statm which is available inside our Linux containers.
    """

    if not _DEBUG_MEMORY:
        return

    try:
        with open("/proc/self/statm") as f:
            parts = f.read().split()
        # statm reports the number of pages; convert to MiB
        pages = int(parts[1])
        rss_mb = pages * (os.sysconf("SC_PAGE_SIZE") / (1024 * 1024))
        logger.info(f"[RAG][MEM] {context}: RSS={rss_mb:.1f} MiB")
    except Exception as exc:  # pragma: no cover - best-effort logging
        logger.debug(f"[RAG][MEM] Failed to read RSS: {exc}")


def _cleanup_memory(context: Optional[str] = None) -> None:
    """Force Python garbage collection to free memory after heavy RAG operations.

    Note: This mainly helps reclaim unreachable Python objects. The overall RSS of
    the process may not drop immediately because the allocator keeps arenas
    reserved for reuse, but this reduces long-term growth.
    """

    collected = gc.collect()
    logger.debug(f"[RAG] Garbage collection freed {collected} objects")
    if context:
        _log_memory_snapshot(context)


# Configure logging
logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager for the application."""
    # Startup
    logger.info("Starting Tale RAG service...")
    logger.info(f"Version: {__version__}")
    logger.info(f"Host: {settings.host}:{settings.port}")
    logger.info(f"Log level: {settings.log_level}")

    try:
        # Initialize cognee
        await cognee_service.initialize()
        logger.info("Cognee initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize cognee: {e}")
        # Continue anyway - some endpoints may still work

    yield

    # Shutdown
    logger.info("Shutting down Tale RAG service...")



# Create FastAPI application
app = FastAPI(
    title="Tale RAG API",
    description="Retrieval-Augmented Generation service using cognee",
    version=__version__,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)


# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_allowed_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def memory_cleanup_middleware(request: Request, call_next):
    """Middleware that runs basic memory cleanup after each HTTP request.

    This helps keep long-running RAG workers from accumulating unreachable
    Python objects over time. It does not guarantee RSS will shrink for every
    request, but it reduces long-term growth.
    """

    response = await call_next(request)
    _cleanup_memory(context=f"after request {request.url.path}")
    return response


# Exception handlers
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    """Handle HTTP exceptions."""
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            error=exc.__class__.__name__,
            message=exc.detail,
        ).model_dump(),
    )


@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """Handle general exceptions."""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=ErrorResponse(
            error=exc.__class__.__name__,
            message="Internal server error",
            details={"error": str(exc)} if settings.log_level == "debug" else None,
        ).model_dump(),
    )


# ============================================================================
# Core Endpoints
# ============================================================================

@app.get("/", response_model=Dict[str, Any])
async def root():
    """Root endpoint with API information."""
    return {
        "name": "Tale RAG API",
        "version": __version__,
        "description": "Retrieval-Augmented Generation service using cognee",
        "docs": "/docs",
        "redoc": "/redoc",
        "openapi": "/openapi.json",
        "health": "/health",
    }


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy",
        version=__version__,
        cognee_initialized=cognee_service.initialized,
    )


@app.get("/config", response_model=ConfigResponse)
async def get_config():
    """Get current configuration (non-sensitive values only)."""
    llm_config = settings.get_llm_config()
    return ConfigResponse(
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        vector_db_url=settings.vector_db_url,
        vector_db_collection_name=settings.vector_db_collection_name,
        openai_model=llm_config.get("model", ""),
        openai_embedding_model=llm_config.get("embedding_model", ""),
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
        top_k=settings.top_k,
        similarity_threshold=settings.similarity_threshold,
        enable_graph_storage=settings.enable_graph_storage,
        enable_vector_search=settings.enable_vector_search,
    )


# ============================================================================
# Document Management Endpoints
# ============================================================================




async def _persist_text_content(content: str) -> str:
    """Persist text content to a file for cognee."""
    from uuid import uuid4

    ingest_dir = os.path.join(settings.cognee_data_dir, "ingest")
    os.makedirs(ingest_dir, exist_ok=True)

    file_path = os.path.join(ingest_dir, f"text_{uuid4().hex}.txt")
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)

    logger.info(f"Text content persisted: {file_path} ({os.path.getsize(file_path)} bytes)")
    return file_path


async def _ingest_single_document(
    content: str,
    metadata: Optional[Dict[str, Any]],
    document_id: Optional[str],
) -> DocumentAddResponse:
    """Ingest a single text document."""
    # Persist text content to file so cognee can operate on a path
    file_path = await _persist_text_content(content)

    # Add to cognee
    result = await cognee_service.add_document(
        content=file_path,
        metadata=metadata,
        document_id=document_id,
    )

    return DocumentAddResponse(
        success=result.get("success", True),
        document_id=result.get("document_id", document_id or "unknown"),
        chunks_created=result.get("chunks_created", 0),
        message="Document added successfully",
    )


@app.post("/api/v1/documents", response_model=DocumentAddResponse)
async def add_document(request: DocumentAddRequest, background_tasks: "BackgroundTasks"):
    """Add a text document to the knowledge base.

    This endpoint is intentionally simple and only accepts plain text content.
    Heavy ingestion work is delegated to a background task so callers
    (including Convex workflows) don't block on cognee processing.
    """
    # Determine a stable document_id/job_id up front
    doc_id = request.document_id or f"doc-{uuid4().hex}"

    # Create an initial queued job record so callers can immediately query status.
    job_store.create_queued(job_id=doc_id, document_id=doc_id)

    async def _background_ingest_text(
        content: str,
        metadata: Optional[Dict[str, Any]],
        document_id: str,
    ) -> None:
        try:
            job_store.mark_running(job_id=document_id)
            response = await _ingest_single_document(
                content=content,
                metadata=metadata,
                document_id=document_id,
            )
            job_store.mark_completed(
                job_id=document_id,
                document_id=response.document_id,
                chunks_created=response.chunks_created,
            )
        except Exception as exc:  # pragma: no cover - best-effort logging
            job_store.mark_failed(job_id=document_id, error=str(exc))
            logger.error(
                "Background text ingestion failed",
                extra={"document_id": document_id, "error": str(exc)},
            )
        finally:
            # Run memory cleanup after each background ingestion task
            _cleanup_memory(context=f"after background text ingestion for {document_id}")

    background_tasks.add_task(
        _background_ingest_text,
        request.content,
        request.metadata,
        doc_id,
    )

    # Return immediately with queued status so upstream callers (e.g. Convex
    # workflows) don't block on heavy ingestion work.
    return DocumentAddResponse(
        success=True,
        document_id=doc_id,
        chunks_created=0,
        message="Document ingestion queued",
        queued=True,
        job_id=doc_id,
    )


@app.post("/api/v1/documents/upload", response_model=DocumentAddResponse)
async def upload_document(
    file: UploadFile = File(..., description="File to upload"),
    metadata: Optional[str] = Form(None, description="Optional metadata as JSON string"),
    document_id: Optional[str] = Form(None, description="Optional custom document ID"),
    background_tasks: "BackgroundTasks" = None,
):
    """Upload a file to the knowledge base.

    The uploaded file is validated and written to disk during the request,
    but heavy ingestion work is delegated to a background task so callers
    (including Convex workflows) don't block on cognee processing.
    """
    try:
        # Read file content
        content = await file.read()

        # Validate file size (50MB default limit from config)
        max_size_mb = (
            settings.max_document_size_mb
            if hasattr(settings, "max_document_size_mb")
            else 50
        )
        max_size_bytes = max_size_mb * 1024 * 1024

        if len(content) > max_size_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File size exceeds maximum allowed size of {max_size_mb}MB",
            )

        # Create file on disk with original extension in the ingest directory
        ingest_dir = os.path.join(settings.cognee_data_dir, "ingest")
        os.makedirs(ingest_dir, exist_ok=True)
        file_ext = os.path.splitext(file.filename)[1] if file.filename else ""
        tmp_path = os.path.join(ingest_dir, f"upload_{uuid4().hex}{file_ext}")
        with open(tmp_path, "wb") as tmp:
            tmp.write(content)

        # Parse metadata
        parsed_metadata: Dict[str, Any] = {}
        if metadata:
            try:
                parsed_metadata = json.loads(metadata)
            except json.JSONDecodeError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid metadata format. Must be valid JSON string.",
                )

        # Add file metadata
        parsed_metadata["filename"] = file.filename
        parsed_metadata["content_type"] = file.content_type
        parsed_metadata["file_size"] = len(content)

        # Determine document/job id
        doc_id = document_id or f"file-{uuid4().hex}"

        # Create an initial queued job record so callers can immediately query status.
        job_store.create_queued(job_id=doc_id, document_id=doc_id)

        # Enqueue background ingestion of the file path
        async def _background_ingest_file(
            path: str,
            metadata_dict: Dict[str, Any],
            doc_id_inner: str,
        ) -> None:
            try:
                job_store.mark_running(job_id=doc_id_inner)
                result = await cognee_service.add_document(
                    content=path,
                    metadata=metadata_dict,
                    document_id=doc_id_inner,
                )
                job_store.mark_completed(
                    job_id=doc_id_inner,
                    document_id=result.get("document_id", doc_id_inner),
                    chunks_created=result.get("chunks_created", 0),
                )
                logger.info(
                    "Background file ingestion completed",
                    extra={
                        "document_id": result.get("document_id", doc_id_inner),
                        "chunks_created": result.get("chunks_created", 0),
                    },
                )
            except Exception as exc:  # pragma: no cover - best-effort logging
                job_store.mark_failed(job_id=doc_id_inner, error=str(exc))
                logger.error(
                    "Background file ingestion failed",
                    extra={
                        "document_id": doc_id_inner,
                        "error": str(exc),
                    },
                )
            finally:
                # Clean up file after ingestion attempt
                try:
                    if os.path.exists(path):
                        os.unlink(path)
                        logger.debug(f"Cleaned up ingest file: {path}")
                except Exception as cleanup_exc:  # pragma: no cover - best-effort logging
                    logger.warning(
                        "Failed to clean up ingest file",
                        extra={"path": path, "error": str(cleanup_exc)},
                    )

                # Run memory cleanup after each background ingestion task
                _cleanup_memory(context=f"after background file ingestion for {doc_id_inner}")

        if background_tasks is not None:
            background_tasks.add_task(
                _background_ingest_file,
                tmp_path,
                parsed_metadata,
                doc_id,
            )
        else:
            # Fallback for contexts without BackgroundTasks (should be rare)
            await _background_ingest_file(tmp_path, parsed_metadata, doc_id)

        return DocumentAddResponse(
            success=True,
            document_id=doc_id,
            chunks_created=0,
            message=f"File '{file.filename}' upload queued for ingestion",
            queued=True,
            job_id=doc_id,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to upload file: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload file: {str(e)}",
        )


@app.delete("/api/v1/documents/{document_id}", response_model=DocumentDeleteResponse)
async def delete_document(document_id: str):
    """Delete a document from the knowledge base."""
    try:
        result = await cognee_service.delete_document(document_id)

        return DocumentDeleteResponse(
            success=result["success"],
            message=result.get("message", "Document deleted successfully"),
        )

    except Exception as e:
        logger.error(f"Failed to delete document: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete document: {str(e)}",
        )


@app.post("/api/v1/documents/batch", response_model=BatchAddResponse)
async def add_documents_batch(request: BatchAddRequest):
    """Add multiple documents to the knowledge base."""
    results = []
    successful = 0
    failed = 0

    for doc_request in request.documents:
        try:
            result = await cognee_service.add_document(
                content=doc_request.content,
                metadata=doc_request.metadata,
                document_id=doc_request.document_id,
            )
            results.append(
                DocumentAddResponse(
                    success=True,
                    document_id=result["document_id"],
                    chunks_created=result.get("chunks_created", 0),
                    message="Document added successfully",
                )
            )
            successful += 1
        except Exception as e:
            logger.error(f"Failed to add document in batch: {e}")
            results.append(
                DocumentAddResponse(
                    success=False,
                    document_id=doc_request.document_id or "unknown",
                    chunks_created=0,
                    message=f"Failed: {str(e)}",
                )
            )
            failed += 1

    return BatchAddResponse(
        success=failed == 0,
        total_documents=len(request.documents),
        successful=successful,
        failed=failed,
        results=results,
    )


@app.get("/api/v1/jobs/{job_id}", response_model=JobStatus)
async def get_job_status(job_id: str) -> JobStatus:
    """Get the status of a background ingestion job by job_id.

    This endpoint allows callers (including Convex workflows and UIs) to
    poll for progress or completion of asynchronous document ingestion.
    """
    status_obj = job_store.get_job(job_id)
    if status_obj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found",
        )
    return status_obj


# ============================================================================
# Query Endpoints
# ============================================================================

@app.post("/api/v1/search", response_model=QueryResponse)
async def search(request: QueryRequest):
    """Search the knowledge base."""
    try:
        start_time = time.time()

        results = await cognee_service.search(
            query=request.query,
            top_k=request.top_k,
            similarity_threshold=request.similarity_threshold,
            filters=request.filters,
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
        logger.error(f"Search failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Search failed: {str(e)}",
        )


@app.post("/api/v1/generate", response_model=GenerateResponse)
async def generate(request: GenerateRequest):
    """Generate a response using RAG."""
    try:
        result = await cognee_service.generate(
            query=request.query,
            top_k=request.top_k,
            system_prompt=request.system_prompt,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
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
            success=result["success"],
            query=request.query,
            response=result["response"],
            sources=sources,
            processing_time_ms=result["processing_time_ms"],
        )

    except Exception as e:
        logger.error(f"Generation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Generation failed: {str(e)}",
        )

