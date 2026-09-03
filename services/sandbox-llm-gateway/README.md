# @tale/sandbox-llm-gateway

The sandbox LLM gateway ([maximhq/bifrost](https://github.com/maximhq/bifrost) core). The single path from in-sandbox code to an LLM — harnesses (Claude Code / OpenClaw / OpenCode), and the `tale-vision` CLI that agent turns use for image analysis.

## Overview

Raw provider API keys live ONLY here and in the platform. The sandbox holds a session-scoped `sk-bf-*` virtual key (budget + model allowlist), revoked at session destroy. The platform is the source of truth for providers/models; it provisions the gateway via the management API on session create (`services/platform/backend/core/node_only/sandbox/llm_gateway_admin.ts`).

Dual-homed onto two Docker networks:

- `internal` — the platform provisions providers + mints session virtual keys via the management API.
- `sandbox` — in-sandbox agents reach it at `http://sandbox-llm-gateway:8080` over the internal bridge (NOT through the tinyproxy egress).

## Interface

Ports:

- `8080` — management API (`/api/*`) + inference. No published port in `compose.yml` by design (production posture); the host bun-dev path publishes it on loopback via `compose.sandbox-llm-gateway.dev.yml`.

## Configuration

- `SANDBOX_LLM_GATEWAY_URL` — where the platform reaches the management API (default `http://sandbox-llm-gateway:8080`).
- `SANDBOX_LLM_GATEWAY_ADMIN_USERNAME` — management API basic-auth user (default `admin`).
- `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD` — management API basic-auth password. **Required**: the backend refuses every management call without it, so the plane is never anonymous on the sandbox network (`tale deploy` / `bun run dev` mint it; `compose.dev.yml` carries an insecure dev default). Keep it stable — the gateway stores its hash in its volume.
- `SANDBOX_LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS` — per-stream idle timeout passed to the gateway.

The pre-rename `LLM_GATEWAY_*` names are still read as a fallback for one release.

Auth + virtual-key enforcement are config-store fields the platform pushes via `applyGatewayConfig()`, not env knobs on this container.

## Development

```bash
bun run logs   --filter=@tale/sandbox-llm-gateway   # docker compose logs -f sandbox-llm-gateway
bun run shell  --filter=@tale/sandbox-llm-gateway   # exec into the running container
```

## Layout

- `Dockerfile` — thin wrapper re-tagging the upstream `maximhq/bifrost` image with Tale OCI metadata + a healthcheck.
