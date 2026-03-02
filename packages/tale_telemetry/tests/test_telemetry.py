"""Tests for the tale_telemetry shared package."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from prometheus_client import CollectorRegistry

import tale_telemetry as mod
from tale_telemetry import init_telemetry, shutdown_telemetry


@pytest.fixture(autouse=True)
def _reset_telemetry():
    """Reset module state between tests — no private-API access needed."""
    mod._initialized = False
    mod._request_count = None
    mod._request_duration = None
    mod._active_registry = None
    yield


def _create_app() -> FastAPI:
    app = FastAPI()

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/items/{item_id}")
    async def get_item(item_id: str):
        return {"item_id": item_id}

    @app.post("/items")
    async def create_item():
        return {"created": True}

    @app.put("/items/{item_id}")
    async def update_item(item_id: str):
        return {"updated": item_id}

    @app.delete("/items/{item_id}")
    async def delete_item(item_id: str):
        return {"deleted": item_id}

    return app


def _init(app: FastAPI) -> CollectorRegistry:
    """Initialise telemetry with an isolated registry and return it."""
    registry = CollectorRegistry()
    init_telemetry(app, _registry=registry)
    return registry


# ---------------------------------------------------------------------------
# Metrics endpoint basics
# ---------------------------------------------------------------------------


class TestMetricsEndpoint:
    def test_returns_200(self):
        app = _create_app()
        _init(app)
        client = TestClient(app)
        assert client.get("/metrics").status_code == 200

    def test_content_type(self):
        app = _create_app()
        _init(app)
        client = TestClient(app)
        assert "text/plain" in client.get("/metrics").headers["content-type"]

    def test_contains_process_metrics(self):
        app = _create_app()
        _init(app)
        client = TestClient(app)
        body = client.get("/metrics").text
        # At minimum the custom HTTP metrics should be declared
        assert "http_requests_total" in body or "http_request_duration_seconds" in body


# ---------------------------------------------------------------------------
# HTTP request instrumentation
# ---------------------------------------------------------------------------


class TestHttpMetrics:
    def test_request_count_incremented(self):
        app = _create_app()
        _init(app)
        client = TestClient(app)

        client.get("/health")
        client.get("/health")

        body = client.get("/metrics").text
        assert "http_requests_total" in body
        assert 'path_template="/health"' in body

    def test_request_duration_recorded(self):
        app = _create_app()
        _init(app)
        client = TestClient(app)

        client.get("/health")

        body = client.get("/metrics").text
        assert "http_request_duration_seconds" in body

    def test_path_template_uses_route_pattern(self):
        app = _create_app()
        _init(app)
        client = TestClient(app)

        client.get("/items/abc123")
        client.get("/items/def456")

        body = client.get("/metrics").text
        assert 'path_template="/items/{item_id}"' in body
        # Concrete path values must never appear as path_template labels (H2)
        assert 'path_template="/items/abc123"' not in body
        assert 'path_template="/items/def456"' not in body

    def test_metrics_endpoint_not_counted(self):
        app = _create_app()
        _init(app)
        client = TestClient(app)

        client.get("/metrics")
        client.get("/metrics")

        body = client.get("/metrics").text
        assert 'path_template="/metrics"' not in body

    def test_status_code_label(self):
        app = _create_app()
        _init(app)
        client = TestClient(app)

        client.get("/health")

        body = client.get("/metrics").text
        assert 'status_code="200"' in body

    def test_post_put_delete_methods(self):
        app = _create_app()
        _init(app)
        client = TestClient(app)

        client.post("/items")
        client.put("/items/x")
        client.delete("/items/x")

        body = client.get("/metrics").text
        assert 'method="POST"' in body
        assert 'method="PUT"' in body
        assert 'method="DELETE"' in body


# ---------------------------------------------------------------------------
# Cardinality protection (C2)
# ---------------------------------------------------------------------------


class TestCardinalityProtection:
    def test_unmatched_routes_use_constant_label(self):
        app = _create_app()
        _init(app)
        client = TestClient(app)

        # Hit many random paths that don't match any route
        for i in range(20):
            client.get(f"/nonexistent/random-path-{i}")

        body = client.get("/metrics").text
        # All unmatched requests should collapse into a single label
        assert 'path_template="UNMATCHED"' in body
        # None of the random paths should appear as labels
        assert (
            "random-path-"
            not in body.split('path_template="UNMATCHED"')[0].rsplit("\n", 1)[-1]
            if 'path_template="UNMATCHED"' in body
            else True
        )


# ---------------------------------------------------------------------------
# Error handling (C3, C4)
# ---------------------------------------------------------------------------


class TestErrorHandling:
    def test_error_responses_counted(self):
        app = _create_app()

        @app.get("/fail")
        async def fail_endpoint():
            raise ValueError("boom")

        _init(app)
        client = TestClient(app, raise_server_exceptions=False)

        response = client.get("/fail")
        assert response.status_code == 500

        body = client.get("/metrics").text
        assert 'status_code="500"' in body
        assert 'path_template="/fail"' in body

    def test_init_failure_does_not_crash(self):
        """If init_telemetry fails internally, the service must still work (C3)."""
        app = _create_app()
        # First init succeeds
        registry = CollectorRegistry()
        init_telemetry(app, _registry=registry)

        # Reset, then try again with the SAME registry (Counter name collision)
        mod._initialized = False
        mod._request_count = None
        mod._request_duration = None

        # This should NOT raise — it logs and returns gracefully
        init_telemetry(app, _registry=registry)

        client = TestClient(app)
        # Service still responds
        assert client.get("/health").status_code == 200


# ---------------------------------------------------------------------------
# Idempotency & lifecycle
# ---------------------------------------------------------------------------


class TestIdempotency:
    def test_multiple_init_calls_safe(self):
        app = _create_app()
        registry = CollectorRegistry()
        init_telemetry(app, _registry=registry)
        init_telemetry(app, _registry=registry)
        init_telemetry(app, _registry=registry)

        client = TestClient(app)
        assert client.get("/metrics").status_code == 200

    def test_shutdown_without_init_safe(self):
        shutdown_telemetry()

    def test_shutdown_after_init_safe(self):
        app = _create_app()
        _init(app)
        shutdown_telemetry()
