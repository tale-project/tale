"""Prometheus metrics for Tale Operator service.

Exposes a GET /metrics endpoint in Prometheus text format with:
- HTTP request count and duration (using FastAPI route templates)
- Process CPU, memory, threads, open FDs (auto-collected)
- Python GC stats (auto-collected)
"""

import time

from fastapi import FastAPI, Response
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Histogram,
    generate_latest,
    multiprocess,
)
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response as StarletteResponse

# Use the default registry (auto-registers process + GC collectors)
_registry: CollectorRegistry | None = None

_request_count: Counter | None = None
_request_duration: Histogram | None = None


def _get_path_template(request: Request) -> str:
    """Extract the route template from a FastAPI request.

    Returns the route pattern (e.g. '/api/crawl/{job_id}') instead of the
    actual path ('/api/crawl/abc123') to prevent label cardinality explosion.
    """
    route = request.scope.get("route")
    if route and hasattr(route, "path"):
        return route.path
    return request.url.path


class _MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> StarletteResponse:
        if request.url.path == "/metrics":
            return await call_next(request)

        start = time.perf_counter()
        response = await call_next(request)
        duration = time.perf_counter() - start

        path_template = _get_path_template(request)
        if _request_count is not None:
            _request_count.labels(method=request.method, path_template=path_template, status=response.status_code).inc()
        if _request_duration is not None:
            _request_duration.labels(method=request.method, path_template=path_template).observe(duration)

        return response


def init_telemetry(app: FastAPI) -> None:
    """Initialize Prometheus metrics and mount /metrics endpoint.

    Should be called early in the FastAPI lifespan, before other init.
    Safe to call multiple times (idempotent).
    """
    global _registry, _request_count, _request_duration

    if _registry is not None:
        return

    _registry = CollectorRegistry()

    # Check if running under gunicorn/multiprocess mode
    try:
        multiprocess.MultiProcessCollector(_registry)
    except ValueError:
        # Not in multiprocess mode — use default registry instead
        from prometheus_client import REGISTRY

        _registry = REGISTRY

    _request_count = Counter(
        "http_requests_total",
        "Total HTTP requests",
        ["method", "path_template", "status"],
        registry=_registry,
    )
    _request_duration = Histogram(
        "http_request_duration_seconds",
        "HTTP request duration in seconds",
        ["method", "path_template"],
        registry=_registry,
    )

    app.add_middleware(_MetricsMiddleware)

    @app.get("/metrics", include_in_schema=False)
    async def metrics_endpoint() -> Response:
        return Response(
            content=generate_latest(_registry),
            media_type=CONTENT_TYPE_LATEST,
        )


def shutdown_telemetry() -> None:
    """Cleanup telemetry resources.

    No-op for prometheus_client, but provides a consistent init/shutdown
    pattern for future extension (e.g. OTLP push).
    """
