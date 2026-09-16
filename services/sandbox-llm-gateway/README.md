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
- `SANDBOX_LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS` — per-stream idle timeout passed to the gateway: how long it waits for the next byte from an upstream before it aborts the stream (default `600`, the full request timeout). Managed Claude Code turns wait at least as long before they give up on a silent stream and send the request again, both before the first byte (`API_FORCE_IDLE_TIMEOUT=0` lifts Bun's 300 s fetch timeout, `API_TIMEOUT_MS` follows this budget) and between chunks (`CLAUDE_STREAM_IDLE_TIMEOUT_MS`, never below the CLI's own 300 s), so raise this one value for a local model whose prefill can outlast it.

The pre-rename `LLM_GATEWAY_*` names are still read as a fallback; use the `SANDBOX_LLM_GATEWAY_*` names for new configuration.

Auth + virtual-key enforcement are config-store fields the platform pushes via `applyGatewayConfig()`, not env knobs on this container.

## Connect private model providers

Set `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` in the **backend** environment when a
custom model provider uses a private address. On session creation, the backend
checks both the hostname and its resolved addresses before configuring the
gateway. It enables `network_config.allow_private_network` only for an admitted
private destination. Cloud-metadata names and resolved addresses remain refused;
public destinations keep the gateway’s default restriction.

The provider hostname must resolve from both the backend and gateway networks.
Both must reach the endpoint and trust its HTTPS certificate. The preflight is
not a DNS pin for later gateway requests. Keep provider definitions and DNS under
operator control. A successful ordinary chat checks the backend path; verify a
new agent session separately to exercise this gateway.

Recreate the backend processes after changing their environment. This setting
does not change the general sandbox `SANDBOX_EGRESS_ALLOWLIST`. Follow the
[provider configuration guide](../../docs/en/self-hosted/configuration/providers.md)
for endpoint syntax, credentials and verification.

## Development

```bash
bun run --filter @tale/sandbox-llm-gateway logs   # docker compose logs -f sandbox-llm-gateway
bun run --filter @tale/sandbox-llm-gateway shell   # exec into the running container
```

## Layout

- `Dockerfile` — thin wrapper re-tagging the upstream `maximhq/bifrost` image with Tale OCI metadata + a healthcheck.
