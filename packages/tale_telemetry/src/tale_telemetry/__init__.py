"""Prometheus telemetry for Tale Python services.

Exposes a GET /metrics endpoint in Prometheus text format with:
- HTTP request count and duration (using FastAPI route templates)
- Process CPU, memory, threads, open FDs (auto-collected)
- Python GC stats (auto-collected)

Usage:
    from tale_telemetry import init_telemetry, shutdown_telemetry

    app = FastAPI(...)
    init_telemetry(app)

    # In lifespan shutdown:
    shutdown_telemetry()
"""

import logging
import time
from typing import Any

from fastapi import FastAPI, Response
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    REGISTRY,
    CollectorRegistry,
    Counter,
    Histogram,
    generate_latest,
)

logger = logging.getLogger(__name__)

_initialized = False
_request_count: Counter | None = None
_request_duration: Histogram | None = None
_active_registry: CollectorRegistry | None = None

# Custom buckets optimised for HTTP request latencies (10 ms – 10 s).
_HTTP_DURATION_BUCKETS = (
    0.01,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1.0,
    2.5,
    5.0,
    10.0,
    float("inf"),
)


def _get_path_template(scope: dict[str, Any]) -> str:
    """Return the route template from an ASGI scope.

    Falls back to ``"UNMATCHED"`` when no route was matched (e.g. 404) to
    prevent label-cardinality explosion from random request paths.
    """
    route = scope.get("route")
    if route and hasattr(route, "path"):
        return route.path
    return "UNMATCHED"


def _record_metrics(scope: dict[str, Any], status_code: int, duration: float) -> None:
    """Safely record request metrics — never raises."""
    try:
        path_template = _get_path_template(scope)
        method = scope.get("method", "UNKNOWN")
        if _request_count is not None:
            _request_count.labels(
                method=method,
                path_template=path_template,
                status_code=str(status_code),
            ).inc()
        if _request_duration is not None:
            _request_duration.labels(
                method=method,
                path_template=path_template,
            ).observe(duration)
    except Exception:
        logger.debug("Failed to record request metrics", exc_info=True)


class _MetricsMiddleware:
    """Pure ASGI middleware for HTTP request instrumentation.

    Avoids ``BaseHTTPMiddleware`` which wraps response bodies, breaks
    streaming responses, and adds ~50-200 µs overhead per request.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http" or scope["path"] == "/metrics":
            await self.app(scope, receive, send)
            return

        start = time.perf_counter()
        status_code = 500  # default if response never starts

        async def send_wrapper(message: dict[str, Any]) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            raise
        finally:
            _record_metrics(scope, status_code, time.perf_counter() - start)


def init_telemetry(app: FastAPI, *, _registry: CollectorRegistry | None = None) -> None:
    """Initialise Prometheus metrics and mount ``/metrics``.

    Call after app creation but before the server starts accepting requests.
    Safe to call multiple times (idempotent).

    The ``_registry`` parameter exists for test isolation — production code
    should not pass it.  Prometheus service-differentiation is handled by the
    ``job`` label added at scrape time, following standard Prometheus practice.
    """
    global _initialized, _request_count, _request_duration, _active_registry

    if _initialized:
        return

    registry = _registry or REGISTRY
    _active_registry = registry

    try:
        _request_count = Counter(
            "http_requests_total",
            "Total HTTP requests by method, route, and status code",
            ["method", "path_template", "status_code"],
            registry=registry,
        )
        _request_duration = Histogram(
            "http_request_duration_seconds",
            "HTTP request duration in seconds",
            ["method", "path_template"],
            buckets=_HTTP_DURATION_BUCKETS,
            registry=registry,
        )

        app.add_middleware(_MetricsMiddleware)

        @app.get("/metrics", include_in_schema=False)
        async def metrics_endpoint() -> Response:
            return Response(
                content=generate_latest(registry),
                media_type=CONTENT_TYPE_LATEST,
            )

        _initialized = True
    except Exception:
        logger.exception("Failed to initialise telemetry — metrics will be unavailable")


def shutdown_telemetry() -> None:
    """Clean up telemetry resources.

    Currently a no-op for ``prometheus_client``, but provides a consistent
    init/shutdown contract for future extension (e.g. OTLP push).
    """
