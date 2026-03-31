---
title: API reference
description: REST API endpoints for RAG, Crawler, and Platform services.
---

Each Tale service has its own REST API. These are used internally between services but are also available for direct integration with external systems.

## Interactive API documentation

All Python-based services have a Swagger UI for exploring and testing the API:

| Service | Swagger UI URL | OpenAPI JSON |
| --- | --- | --- |
| RAG | http://localhost:8001/docs | http://localhost:8001/openapi.json |
| Crawler | http://localhost:8002/docs | http://localhost:8002/openapi.json |

## RAG API

The RAG API handles document indexing and search. It is the engine behind the knowledge base.

### Upload a document

```http
POST /api/v1/documents/upload
Content-Type: multipart/form-data
```

```text
file:      <binary file data>
file_id:   "unique-file-id"
sync:      "true"  (optional, wait for indexing to complete)
metadata:  '{"source": "upload"}'  (optional JSON string)
```

Document indexing runs in the background by default. Set `sync=true` to wait for indexing to complete before the response returns.

### Check document statuses

```http
POST /api/v1/documents/statuses
```

```json
{
  "file_ids": ["file-id-1", "file-id-2"]
}
```

Returns the indexing status for each document. States: `queued`, `running`, `completed`, `failed`.

### Search the knowledge base

```http
POST /api/v1/search
```

```json
{
  "query": "What is our return policy?",
  "file_ids": ["file-id-1", "file-id-2"],
  "top_k": 5,
  "similarity_threshold": 0.0,
  "include_metadata": true
}
```

The `file_ids` parameter is required and scopes the search to specific documents.

### Delete a document

```http
DELETE /api/v1/documents/{file_id}
```

### Get document content

```http
GET /api/v1/documents/{file_id}/content
```

Returns the full extracted text of an indexed document.

### Compare documents

```http
POST /api/v1/documents/compare
```

```json
{
  "file_id_a": "file-id-1",
  "file_id_b": "file-id-2"
}
```

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

### Get website info

```http
GET /api/v1/websites/{domain}
```

### Deregister a website

```http
DELETE /api/v1/websites/{domain}
```

### List website URLs

```http
GET /api/v1/websites/{domain}/urls
```

## Platform API

The Platform service exposes a public API at `/api/v1/*` for programmatic access to your data. Authenticate using an `x-api-key` header with a key from Settings > API Keys.

Full API documentation: `https://yourdomain.com/api/v1/openapi.json`
