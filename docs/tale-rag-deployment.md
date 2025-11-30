# Tale RAG Deployment Guide

This guide covers the deployment of the Tale RAG (Retrieval-Augmented Generation) service.

## Overview

Tale RAG is a production-ready RAG service built with cognee and FastAPI. It provides semantic search, document management, and AI-powered response generation capabilities.

## Quick Start

### Prerequisites

- Docker and Docker Compose
- OpenAI API key (or other LLM provider)
- Tale DB (PostgreSQL with PGVector) running

### Start the Service

```bash
# Set your OpenAI API key
export OPENAI_API_KEY=sk-your-api-key-here

# Start all Tale services including RAG
docker compose up -d

# Or start only the RAG service
docker compose up -d rag
```

### Verify the Service

```bash
# Check health
curl http://localhost:8001/health

# View API documentation
open http://localhost:8001/docs
```

## Configuration

### Environment Variables

Configuration uses service-prefixed variables for service internals and general variables for cross-service URLs. Key variables include:

#### Required

- `OPENAI_API_KEY` - OpenAI API key for LLM and embeddings
- `DATABASE_URL` - PostgreSQL connection URL (also used for PGVector storage)

#### Server

- `RAG_HOST` - Server host (default: `0.0.0.0`)
- `RAG_PORT` - Server port (default: `8001`)
- `RAG_WORKERS` - Number of workers (default: `1`)
- `RAG_LOG_LEVEL` - Log level (default: `info`)

#### Cognee

- `RAG_CHUNK_SIZE` - Document chunk size (default: `512`)
- `RAG_CHUNK_OVERLAP` - Chunk overlap (default: `50`)
- `RAG_TOP_K` - Number of results (default: `5`)
- `RAG_SIMILARITY_THRESHOLD` - Minimum similarity (default: `0.7`)
- `EMBEDDING_DIMENSIONS` - Embedding vector dimension size. When using custom
  embedding models or providers, this must match your vector store's configured
  dimension.

See [services/rag/README.md](../services/rag/README.md) for complete documentation.

## API Endpoints

### Document Management

- `POST /api/v1/documents` - Add a document
- `DELETE /api/v1/documents/{id}` - Delete a document
- `POST /api/v1/documents/batch` - Batch add documents

### Query & Search

- `POST /api/v1/search` - Semantic search
- `POST /api/v1/generate` - Generate RAG response

### System

- `GET /health` - Health check
- `GET /config` - Configuration
- `GET /docs` - API documentation

## Usage Examples

### Add a Document

```bash
curl -X POST http://localhost:8001/api/v1/documents \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Tale RAG provides powerful semantic search capabilities.",
    "metadata": {"source": "docs", "category": "features"},
    "document_id": "doc-001"
  }'
```

### Search

```bash
curl -X POST http://localhost:8001/api/v1/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the features of Tale RAG?",
    "top_k": 5
  }'
```

### Generate Response

```bash
curl -X POST http://localhost:8001/api/v1/generate \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Explain the capabilities of Tale RAG",
    "top_k": 3
  }'
```

## Docker Deployment

### Using Docker Compose

The recommended deployment method:

```bash
# Start with all Tale services
docker compose up -d

# View logs
docker compose logs -f rag

# Stop the service
docker compose down
```

### Using Docker Directly

```bash
# Build the image
docker build -t tale-rag:latest -f services/rag/Dockerfile .

# Run the container
docker run -d \
  -p 8001:8001 \
  -e OPENAI_API_KEY=sk-... \
  -e DATABASE_URL=postgresql://user:pass@host:5432/db \
  --name tale-rag \
  tale-rag:latest
```

### Multi-Architecture Build

```bash
# Build for AMD64 and ARM64
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t tale-rag:latest \
  -f services/rag/Dockerfile \
  .
```

## GitHub Container Registry

### Pull Pre-built Image

```bash
# Pull from GHCR
docker pull ghcr.io/your-org/poc2/tale-rag:latest

# Run the image
docker run -d \
  -p 8001:8001 \
  -e OPENAI_API_KEY=sk-... \
  ghcr.io/your-org/poc2/tale-rag:latest
```

### Build and Push

The GitHub Actions workflow automatically builds and pushes images:

```bash
# Manual trigger
gh workflow run build-and-push-rag.yml

# Or push a tag
git tag rag-v1.0.0
git push origin rag-v1.0.0
```

## Integration with Tale Platform

### Service Dependencies

Tale RAG integrates with:

1. **Tale DB (PostgreSQL)** - Stores metadata, system data, and vector embeddings (via PGVector)
2. **Tale Graph DB (Kuzu)** - Optional knowledge graph storage

### Network Configuration

All services communicate via the `internal` Docker network:

```yaml
networks:
  internal:
    driver: bridge
```

### Volume Management

Persistent data is stored in:

- `rag-data` - Cognee data directory

## Production Deployment

### Security

```bash
# Set strong API keys
export RAG_API_KEY=$(openssl rand -base64 32)
export RAG_SECRET_KEY=$(openssl rand -base64 32)

# Restrict CORS
export RAG_ALLOWED_ORIGINS=https://yourdomain.com

# Use secure database connections
export DATABASE_URL=postgresql://user:pass@db:5432/production?sslmode=require
```

### Performance

```bash
# Increase workers for high traffic
export RAG_WORKERS=4

# Optimize database connections
export RAG_DATABASE_POOL_SIZE=20
export RAG_DATABASE_MAX_OVERFLOW=40

# Increase concurrent requests
export RAG_MAX_CONCURRENT_REQUESTS=50
```

### Monitoring

```bash
# Enable metrics
export RAG_ENABLE_METRICS=true
export RAG_PROMETHEUS_ENABLED=true

# Enable error tracking
export RAG_SENTRY_DSN=https://...
```

## Troubleshooting

### Service Won't Start

```bash
# Check logs
docker compose logs rag

# Verify environment
docker compose exec rag env | grep RAG_

# Check dependencies
docker compose ps
```

### Connection Issues

```bash
# Test database connection
docker compose exec rag python -c "import asyncpg; print('DB OK')"

# Test vector database
curl http://localhost:6333/healthz

# Check network
docker network inspect poc2_internal
```

### Performance Issues

```bash
# Monitor resources
docker stats tale-rag

# Check database connections
docker compose exec db psql -U tale -c "SELECT count(*) FROM pg_stat_activity;"

# Review logs
docker compose logs --tail=100 rag
```

## Maintenance

### Backup

```bash
# Backup cognee data
docker run --rm \
  -v poc2_rag-data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/rag-data-$(date +%Y%m%d).tar.gz /data
```

### Updates

```bash
# Pull latest image
docker compose pull rag

# Restart service
docker compose up -d rag
```

### Clean Up

```bash
# Remove old containers
docker compose down

# Remove volumes (WARNING: deletes data)
docker compose down -v
```

## Additional Resources

- [README.md](../services/rag/README.md) - Complete documentation
- [QUICKSTART.md](../services/rag/QUICKSTART.md) - Quick start guide
- [IMPLEMENTATION_SUMMARY.md](../services/rag/IMPLEMENTATION_SUMMARY.md) - Technical details
- API Documentation: http://localhost:8001/docs

## Support

For issues and questions:

- GitHub Issues: [Create an issue](https://github.com/your-org/poc2/issues)
- Documentation: http://localhost:8001/docs
- Health Check: http://localhost:8001/health
