---
title: API reference
description: REST API endpoints for RAG, Crawler, Operator, and Platform services.
---

Each Tale service has its own REST API. These are used internally between services but are also available for direct integration with external systems.

## Interactive API documentation

All Python-based services have a Swagger UI for exploring and testing the API:

| Service | Swagger UI URL | OpenAPI JSON |
| --- | --- | --- |
| RAG | http://localhost:8001/docs | http://localhost:8001/openapi.json |
| Crawler | http://localhost:8002/docs | http://localhost:8002/openapi.json |
| Operator | http://localhost:8004/docs | http://localhost:8004/openapi.json |

## RAG API

The RAG API handles document indexing and search. It is the engine behind the knowledge base.

### Add a document

```http
POST /api/v1/documents
```

```json
{
  "content": "Your document text here...",
  "document_id": "optional-custom-id",
  "team_ids": ["team-abc123"],
  "metadata": { "source": "manual", "category": "policy" }
}
```

Document indexing runs in the background. The response includes a `job_id` you can use to check progress.

### Upload a file

```http
POST /api/v1/documents/upload
Content-Type: multipart/form-data
```

```text
file:      <binary file data>
team_ids:  "team-abc123"
metadata:  '{"source": "upload"}'  (optional JSON string)
```

### Search the knowledge base

```http
POST /api/v1/search
```

```json
{
  "query": "What is our return policy?",
  "team_ids": ["team-abc123"],
  "top_k": 5,
  "similarity_threshold": 0.0
}
```

### Check indexing job status

```http
GET /api/v1/jobs/{job_id}
```

Job states: `queued`, `running`, `completed`, `failed`. Keep checking this endpoint until the state is `completed` or `failed`.

## Crawler API

### Register a website for crawling

```http
POST /api/v1/websites
```

```json
{
  "domain": "https://docs.example.com",
  "scan_interval": 21600
}
```

`scan_interval` is in seconds. Minimum value is 60.

### Fetch page content

```http
POST /api/v1/urls/fetch
```

```json
{
  "urls": ["https://docs.example.com/guide"],
  "word_count_threshold": 100
}
```

Returns cached content when available, or fetches it live if not.

## Platform API

The Platform service exposes a public API at `/api/v1/*` for programmatic access to your data. Authenticate using a Bearer token from Settings > API Keys.

Full API documentation: `https://yourdomain.com/api/v1/openapi.json`
