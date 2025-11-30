# Tale RAG

Retrieval-Augmented Generation service built with FastAPI and Cognee. Supports document ingestion (text and file upload), semantic search over PGVector, and answer generation using an LLM.

## Overview

- Adds documents (plain text and files)
- Stores embeddings in PostgreSQL (via PGVector) and metadata in the same database
- Searches relevant chunks and generates answers with the configured LLM
- Optional knowledge graph integration via the Graph DB service

## Ports

- 8001 (HTTP)

## Endpoints (selected)

- GET /health — service health
- GET /config — non-sensitive configuration snapshot
- POST /api/v1/documents — add a text document
- POST /api/v1/documents/upload — upload a file (multipart/form-data)
- DELETE /api/v1/documents/{document_id} — delete by ID (placeholder)
- POST /api/v1/documents/batch — add multiple documents
- POST /api/v1/search — semantic search
- POST /api/v1/generate — generate an answer using RAG

OpenAPI docs at /docs.

## Quick Examples

Health:

```
curl -s http://localhost:8001/health
```

Add text:

```
curl -s -X POST http://localhost:8001/api/v1/documents \
  -H 'Content-Type: application/json' \
  -d '{"content":"Hello Tale RAG","document_id":"doc-1"}'
```

Search:

```
curl -s -X POST http://localhost:8001/api/v1/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"What is Tale RAG?","top_k":3}'
```

Generate (requires OPENAI_API_KEY):

```
curl -s -X POST http://localhost:8001/api/v1/generate \
  -H 'Content-Type: application/json' \
  -d '{"query":"Explain Tale RAG","top_k":3}'
```

Or run the helper script:

```
./services/rag/test-setup.sh
```

## Configuration

Environment (general + service-specific); see app/config.py for defaults:

- Server: HOST, PORT, WORKERS, LOG_LEVEL
- Database (Postgres): DATABASE_URL (e.g., postgresql://user:pass@db:5432/tale), DATABASE_POOL_SIZE, DATABASE_MAX_OVERFLOW
- Vector DB: Uses PGVector via the same PostgreSQL database (no separate configuration needed)
- Graph DB (optional): GRAPH_DB_URL, GRAPH_DB_PATH
- LLM (OpenAI-compatible): OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_EMBEDDING_MODEL, OPENAI_MAX_TOKENS, OPENAI_TEMPERATURE
  - Supports OpenAI and OpenAI-compatible APIs (DeepSeek, Together AI, etc.)
  - Set OPENAI_BASE_URL to use alternative providers (e.g., https://api.deepseek.com/v1)
- Embeddings: EMBEDDING_DIMENSIONS (embedding vector dimension size; when using
  custom embedding models or providers, this must match your vector store's
  configured dimension)
- Cognee: COGNEE_DATA_DIR, COGNEE_LOG_LEVEL, CHUNK_SIZE, CHUNK_OVERLAP
- Retrieval: TOP_K, SIMILARITY_THRESHOLD
- Upload limits: MAX_DOCUMENT_SIZE_MB
- Security/Features: API_KEY, ALLOWED_ORIGINS, ENABLE_GRAPH_STORAGE, ENABLE_VECTOR_SEARCH, ENABLE_METRICS, ENABLE_QUERY_LOGGING

Notes:

- The service maps OPENAI*API_KEY to cognee’s expected LLM*\* envs at startup (see services/cognee_service.py)
- When running under Docker Compose, defaults point to other service DNS names (db, graph-db); vector storage uses PGVector via PostgreSQL

### Using OpenAI-Compatible APIs

The RAG service supports any OpenAI-compatible API by customizing the base URL. Here are examples for popular providers:

#### DeepSeek

```bash
export OPENAI_API_KEY=sk-your-deepseek-key
export OPENAI_BASE_URL=https://api.deepseek.com
export OPENAI_MODEL=deepseek-chat
```

#### Together AI

```bash
export OPENAI_API_KEY=your-together-key
export OPENAI_BASE_URL=https://api.together.xyz/v1
export OPENAI_MODEL=meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo
```

#### OpenRouter

```bash
export OPENAI_API_KEY=sk-or-v1-your-key
export OPENAI_BASE_URL=https://openrouter.ai/api/v1
export OPENAI_MODEL=anthropic/claude-3.5-sonnet
```

#### Local LLM (Ollama)

```bash
export OPENAI_API_KEY=ollama
export OPENAI_BASE_URL=http://localhost:11434/v1
export OPENAI_MODEL=llama3.2
```

**Note**: Azure OpenAI requires a different client class and is not directly compatible with the standard OpenAI base URL approach. For Azure OpenAI support, additional configuration would be needed.

## Run with Docker Compose

```
docker compose up -d rag
```

## Integration

- Uses PGVector for embeddings and Postgres for Cognee’s storage (same database)
- Optionally uses the Graph DB for graph-backed features
