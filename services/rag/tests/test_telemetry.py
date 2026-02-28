"""Tests for Prometheus telemetry module."""

import contextlib

import prometheus_client
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.telemetry import init_telemetry, shutdown_telemetry


@pytest.fixture(autouse=True)
def _reset_telemetry():
    """Reset telemetry module state between tests."""
    import app.telemetry as mod

    mod._registry = None
    mod._request_count = None
    mod._request_duration = None
    # Only unregister our custom metrics, keep default process/GC collectors
    for name in list(prometheus_client.REGISTRY._names_to_collectors.keys()):
        if name.startswith(("http_requests", "http_request_duration")):
            with contextlib.suppress(Exception):
                prometheus_client.REGISTRY.unregister(prometheus_client.REGISTRY._names_to_collectors[name])
    yield


def _create_app() -> FastAPI:
    app = FastAPI()

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/items/{item_id}")
    async def get_item(item_id: str):
        return {"item_id": item_id}

    return app


class TestMetricsEndpoint:
    def test_metrics_returns_200(self):
        app = _create_app()
        init_telemetry(app)
        client = TestClient(app)

        response = client.get("/metrics")
        assert response.status_code == 200

    def test_metrics_content_type(self):
        app = _create_app()
        init_telemetry(app)
        client = TestClient(app)

        response = client.get("/metrics")
        assert "text/plain" in response.headers["content-type"]

    def test_metrics_contains_process_metrics(self):
        app = _create_app()
        init_telemetry(app)
        client = TestClient(app)

        response = client.get("/metrics")
        body = response.text
        assert "process_cpu_seconds_total" in body or "process_virtual_memory_bytes" in body


class TestHttpMetrics:
    def test_request_count_incremented(self):
        app = _create_app()
        init_telemetry(app)
        client = TestClient(app)

        client.get("/health")
        client.get("/health")

        response = client.get("/metrics")
        body = response.text
        assert "http_requests_total" in body
        assert 'path_template="/health"' in body

    def test_request_duration_recorded(self):
        app = _create_app()
        init_telemetry(app)
        client = TestClient(app)

        client.get("/health")

        response = client.get("/metrics")
        body = response.text
        assert "http_request_duration_seconds" in body

    def test_path_template_uses_route_pattern(self):
        app = _create_app()
        init_telemetry(app)
        client = TestClient(app)

        client.get("/items/abc123")
        client.get("/items/def456")

        response = client.get("/metrics")
        body = response.text
        # Should use the template, not the actual path
        assert 'path_template="/items/{item_id}"' in body
        assert "abc123" not in body or 'path_template="/items/abc123"' not in body

    def test_metrics_endpoint_not_counted(self):
        app = _create_app()
        init_telemetry(app)
        client = TestClient(app)

        client.get("/metrics")
        client.get("/metrics")

        response = client.get("/metrics")
        body = response.text
        assert 'path_template="/metrics"' not in body


class TestIdempotency:
    def test_multiple_init_calls_safe(self):
        app = _create_app()
        init_telemetry(app)
        init_telemetry(app)
        init_telemetry(app)

        client = TestClient(app)
        response = client.get("/metrics")
        assert response.status_code == 200

    def test_shutdown_without_init_safe(self):
        shutdown_telemetry()

    def test_shutdown_after_init_safe(self):
        app = _create_app()
        init_telemetry(app)
        shutdown_telemetry()
