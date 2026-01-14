"""Graph DB REST API service for Kuzu - Cognee compatible."""

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from loguru import logger
from pydantic import BaseModel

from .config import settings
from .database import db


class QueryRequest(BaseModel):
    """Query request model - matches Cognee's expected format."""

    query: str
    parameters: dict[str, Any] | None = None


class QueryResponse(BaseModel):
    """Query response model - matches Cognee's expected format."""

    data: list[list[Any]]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info("Starting Graph DB service...")
    db.connect()
    yield
    logger.info("Shutting down Graph DB service...")
    db.close()


app = FastAPI(
    title="Graph DB Service",
    description="Kuzu graph database REST API - Cognee compatible",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy", "service": "graph-db", "database": "kuzu"}


@app.post("/query", response_model=QueryResponse)
async def execute_query(request: QueryRequest):
    """Execute a Cypher query.

    This endpoint matches Cognee's expected kuzu-remote API format:
    - POST /query
    - Request: {"query": "...", "parameters": {}}
    - Response: {"data": [[...]]}
    """
    try:
        logger.debug(f"Executing query: {request.query}")
        if request.parameters:
            logger.debug(f"Parameters: {request.parameters}")

        rows = db.execute(request.query, request.parameters)
        return QueryResponse(data=rows)
    except Exception as e:
        logger.error(f"Query execution failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=settings.host, port=settings.port)

