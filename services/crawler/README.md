# Tale Crawler

Independent web crawling service built on FastAPI + Crawl4AI. Provides REST APIs for URL discovery and content extraction. Used by the RAG service, but can be called directly.

## Overview

- Discovers URLs from a domain using sitemaps and (optionally) Common Crawl
- Crawls pages concurrently and extracts clean text + basic metadata
- Filters by URL pattern and minimum word count
- Designed to run headless Chromium via Playwright in the container

## Ports

- 8002 (HTTP)

## Key Endpoints

- GET /health — health status
- POST /api/v1/discover — discover URLs on a domain
- POST /api/v1/crawl — discover + crawl pages and return structured content
- GET /api/v1/check-url?url=... — check if a URL looks like a website vs a single doc

See OpenAPI docs at /docs when the service is running.

## Request/Response Models (selected)

CrawlRequest:

- url (string, required)
- max_pages (int, default 100)
- pattern (string, optional)
- query (string, optional)
- word_count_threshold (int, default 100)

DiscoverRequest:

- domain (string, required)
- max_urls (int, default 100)
- pattern (string, optional)
- query (string, optional)

## Examples

Health:

```
curl -s http://localhost:8002/health
```

Discover:

```
curl -s -X POST http://localhost:8002/api/v1/discover \
  -H 'Content-Type: application/json' \
  -d '{"domain":"docs.example.com","max_urls":50,"pattern":"*/docs/*"}'
```

Crawl:

```
curl -s -X POST http://localhost:8002/api/v1/crawl \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","max_pages":25,"word_count_threshold":50}'
```

Check URL type:

```
curl -s 'http://localhost:8002/api/v1/check-url?url=https://example.com'
```

A helper script exists:

```
./services/crawler/test-crawler.sh
```

## Configuration

Environment variables (prefix CRAWLER\_):

- HOST, PORT, WORKERS, LOG_LEVEL
- ALLOWED_ORIGINS (CORS)
- MAX_CONCURRENT_CRAWLS, DEFAULT_MAX_PAGES, DEFAULT_WORD_COUNT_THRESHOLD, DEFAULT_CONCURRENCY, REQUEST_TIMEOUT_SECONDS

See app/config.py for defaults and descriptions.

## Running in Docker

```
docker compose up -d crawler
```

## Notes

- The Dockerfile installs Playwright/Chromium; the first run will download browser binaries
- Consider lowering DEFAULT_CONCURRENCY and MAX_CONCURRENT_CRAWLS on low-memory hosts
