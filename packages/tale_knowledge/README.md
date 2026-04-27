# tale-knowledge

Knowledge-pipeline primitives shared by the `rag` and `crawler` Python services.

## Overview

Pure library — no FastAPI, no DB connections. Consumers hold the side effects; this package provides the algorithms (chunking, embedding, extraction, retrieval, vision).

## Interface

Public modules:

- `chunking` — semantic text splitting (token-aware, configurable overlap)
- `embedding` — OpenAI-compatible embedding client + batching
- `extraction` — text extraction by file type (`pdf`, `docx`, `pptx`, `xlsx`, `image`, `text`) with a unified `router`
- `retrieval` — Reciprocal Rank Fusion and reranker wrappers
- `vision` — vision-LLM client and response cache (used for OCR / image understanding)

## Configuration

Consumed as a path dependency:

```toml
[project]
dependencies = ["tale-knowledge"]

[tool.uv.sources]
tale-knowledge = { path = "../../packages/tale_knowledge" }
```

## Development

```bash
bun run lint   --filter=@tale/knowledge   # ruff check
bun run format --filter=@tale/knowledge   # ruff format
```

Tests run via the consuming service's `uv run pytest`.

## Layout

- `src/tale_knowledge/` — package source (`chunking/`, `embedding/`, `extraction/`, `retrieval/`, `vision/`)
- `tests/` — pytest suite
