# @tale/crawler

FastAPI service for web crawling, URL discovery, and document/file conversion.

## Overview

Built on Crawl4AI; produces normalised text and chunks that the platform stores in the knowledge base. Persists to Postgres (`tale_knowledge`); migrations in `migrations/` are applied with `dbmate` at container startup. Shares chunking, embedding, extraction, and vision primitives via `tale-knowledge`, infrastructure helpers via `tale-shared`, and metrics via `tale-telemetry`.

## Interface

Ports:

- `8002` — HTTP API

Routers under `app/routers/`:

- `crawler`, `web`, `pages`, `websites` — crawling and URL discovery
- `pdf`, `docx`, `pptx`, `image` — file parsing and OCR
- `index`, `search` — content indexing and hybrid search

## Configuration

Settings live in `app/config.py` (pydantic-settings). The canonical environment list is in `compose.yml`.

## Development

```bash
bun run setup --filter=@tale/crawler   # uv sync --extra dev
bun run serve --filter=@tale/crawler   # uvicorn --reload on :8002
bun run test  --filter=@tale/crawler
bun run lint  --filter=@tale/crawler
```

Or directly inside `services/crawler/`:

```bash
uv sync --extra dev
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8002
uv run pytest
```

## Layout

- `app/main.py` — FastAPI app, lifespan, CORS, telemetry init
- `app/config.py` — settings
- `app/routers/` — API endpoints by domain
- `app/services/` — business logic (crawler, image, pdf, …)
- `app/models.py` — request/response DTOs
- `migrations/` — dbmate SQL migrations
