# @tale/rag

FastAPI service that owns retrieval-augmented generation: ingest, embed, hybrid search (BM25 + vector), rerank, and an LLM semantic cache.

## Overview

Persists to Postgres (`tale_knowledge`); migrations in `migrations/` are applied with `dbmate` at container startup. Shares chunking, embedding, extraction, retrieval, and vision primitives via `tale-knowledge`, infrastructure helpers via `tale-shared`, and metrics via `tale-telemetry`. A periodic GC sweep runs every 60s to bound memory under heavy ingest.

## Interface

Ports:

- `8001` — HTTP API

Routers under `app/routers/`:

- `documents` — upload, parse, chunk, embed, persist
- `search` — hybrid retrieval with reranking
- `llm_cache` — semantic LLM response cache
- `health` — readiness and liveness

## Configuration

Settings live in `app/config.py` (pydantic-settings). The canonical environment list is in `compose.yml`. Document ingest applies `detect-secrets`-based redaction via `app/secret_scanner.py`.

## Development

```bash
bun run setup --filter=@tale/rag       # uv sync --extra dev
bun run serve --filter=@tale/rag       # uvicorn --reload on :8001
bun run test  --filter=@tale/rag
bun run lint  --filter=@tale/rag
```

Or directly inside `services/rag/`:

```bash
uv sync --extra dev
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
uv run pytest
```

## Layout

- `app/main.py` — FastAPI app, lifespan, telemetry init
- `app/config.py` — settings
- `app/routers/` — API endpoints by domain
- `app/services/` — RAG orchestration, embedding, indexing
- `app/secret_scanner.py` — secret redaction for ingested documents
- `migrations/` — dbmate SQL migrations
