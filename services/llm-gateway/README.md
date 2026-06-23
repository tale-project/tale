# @tale/llm-gateway

The LLM gateway ([maximhq/bifrost](https://github.com/maximhq/bifrost) core). The single path from an in-sandbox coding agent (Claude Code / OpenCode) to an LLM.

## Overview

Raw provider API keys live ONLY here and in the platform. The sandbox holds a session-scoped `sk-bf-*` virtual key (budget + model allowlist), revoked at session destroy. The platform is the source of truth for providers/models; it provisions the gateway via the management API on session create (`convex/node_only/sandbox/llm_gateway_admin.ts`).

Dual-homed onto two Docker networks:

- `internal` — the platform provisions providers + mints session virtual keys via the management API.
- `sandbox` — in-sandbox agents reach it at `http://llm-gateway:8080` over the internal bridge (NOT through the tinyproxy egress).

## Interface

Ports:

- `8080` — management API (`/api/*`) + inference. No published port in `compose.yml` by design (production posture); the host bun-dev path publishes it on loopback via `compose.llm-gateway.dev.yml`.

## Configuration

- `LLM_GATEWAY_URL` — where the platform reaches the management API (default `http://llm-gateway:8080`).
- `LLM_GATEWAY_ADMIN_USERNAME` — management API basic-auth user (default `admin`).
- `LLM_GATEWAY_ADMIN_PASSWORD` — management API basic-auth password. When set, the management plane stops being anonymous on the internal network.
- `LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS` — per-stream idle timeout passed to the gateway.

Auth + virtual-key enforcement are config-store fields the platform pushes via `applyGatewayConfig()`, not env knobs on this container.

## Development

```bash
bun run logs   --filter=@tale/llm-gateway   # docker compose logs -f llm-gateway
bun run shell  --filter=@tale/llm-gateway   # exec into the running container
```

## Layout

- `Dockerfile` — thin wrapper re-tagging the upstream `maximhq/bifrost` image with Tale OCI metadata + a healthcheck.
