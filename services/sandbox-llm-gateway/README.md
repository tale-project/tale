# @tale/sandbox-llm-gateway

The sandbox LLM gateway ([maximhq/bifrost](https://github.com/maximhq/bifrost) core). The single path from in-sandbox code to an LLM — harnesses (Claude Code / OpenClaw / OpenCode), and the `tale-vision` CLI that agent turns use for image analysis — and the serving path of the platform's model endpoints for API keys (`/api/v1/openai`, `/api/v1/anthropic`), which relay a key holder's request to the gateway's own `/openai/v1/chat/completions` and `/anthropic/v1/messages` doors with a virtual key minted for that one request (`services/platform/backend/domains/model_api/`).

## Overview

Raw provider API keys live ONLY here and in the platform. The sandbox holds a session-scoped `sk-bf-*` virtual key (budget + model allowlist), revoked at session destroy. The platform is the source of truth for providers/models; it provisions the gateway via the management API on session create (`services/platform/backend/core/node_only/sandbox/llm_gateway_admin.ts`).

Dual-homed onto two Docker networks:

- `internal` — the platform provisions providers + mints session virtual keys via the management API, and relays model-endpoint requests to its inference doors. The port stays unpublished: API key holders reach the models through the platform, never the gateway.
- `sandbox` — in-sandbox agents reach it at `http://sandbox-llm-gateway:8080` over the internal bridge (NOT through the tinyproxy egress).

## Interface

Ports:

- `8080` — management API (`/api/*`) + inference. No published port in `compose.yml` by design (production posture); the host bun-dev path publishes it on loopback via `compose.sandbox-llm-gateway.dev.yml`.

## Configuration

- `SANDBOX_LLM_GATEWAY_URL` — where the platform reaches the management API (default `http://sandbox-llm-gateway:8080`).
- `SANDBOX_LLM_GATEWAY_ADMIN_USERNAME` — management API basic-auth user (default `admin`).
- `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD` — management API basic-auth password. **Required**: the backend refuses every management call without it, so the plane is never anonymous on the sandbox network (`tale deploy` / `bun run dev` mint it; `compose.dev.yml` carries an insecure dev default). Keep it stable — the gateway stores its hash in its volume. The gateway reads it too: its entrypoint always makes it the setup token (`BIFROST_SETUP_TOKEN`) that a gateway without an admin account demands before it creates one, so the backend can claim a fresh gateway and nothing else on its networks can. A `BIFROST_SETUP_TOKEN` set on the container is replaced, with a notice in the log: the backend presents the admin password, never another token, so any other value would keep a fresh gateway from ever getting its admin account.
- `SANDBOX_LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS` — per-stream idle timeout passed to the gateway: how long it waits for the next byte from an upstream before it aborts the stream (default `600`). A value above 600 also raises the gateway's per-request timeout (`default_request_timeout_in_seconds`, never below 600), which bounds a whole non-streaming answer, the fallback a harness takes when a stream breaks, and how long an upstream may take to send a stream's response headers. Managed Claude Code turns wait at least as long before they give up and send the request again, both before the first byte (`API_FORCE_IDLE_TIMEOUT=0` lifts Bun's 300 s fetch timeout, `API_TIMEOUT_MS` follows the request timeout) and between chunks (`CLAUDE_STREAM_IDLE_TIMEOUT_MS`, never below the CLI's own 300 s), so raise this one value for a local model whose prefill can outlast it.
- `SANDBOX_LLM_GATEWAY_PROVIDER_CONCURRENCY` / `SANDBOX_LLM_GATEWAY_CUSTOM_PROVIDER_CONCURRENCY` — request workers per provider record, pushed as its `concurrency_and_buffer_size` (default `512` for a shared standard record, `64` for an org-scoped custom record; the queue is 16 requests per worker). The gateway starts a record's workers as goroutines when it loads the record — at boot for every stored record, and on each create or update — and keeps them whether or not anything calls the record, so a custom record per (organization, connector, model), plus its `__anthropic` sibling, multiplies parked workers with organizations times custom models. At the gateway's own default of 1,000 workers, each record parks about 2–8 MiB of goroutine stacks (2–8 KiB per goroutine), so 64 to 256 records fill the container's 512 MiB limit on stacks alone, and a gateway over its limit is killed again at every boot. A request that finds every worker busy waits in the queue, and one that finds the queue full waits for room in it until its caller hangs up: the backend keeps the gateway's `drop_excess_requests` off (its default), which would otherwise answer it 503 `request dropped: queue is full`, and rewrites a store that has it on. A whole number from 1 to 5,000 (the gateway's default connections per upstream host): a larger one is held to 5,000 and anything else falls back to the default, each with a warning. The fingerprint the backend provisions under includes the pool, and a fresh backend process rewrites each record once, so a record picks up a new size at the next provision of an organization that uses it. A provision rewrites only the records it names, so a record nothing provisions again (a model an organization removed or renamed, an `__anthropic` sibling of a lane no session rides, an inactive organization's records) would keep the pool it was stored with. Each backend process therefore runs one shrink pass in the background after its first provision has applied the gateway's auth posture: it lists every record (`GET /api/providers`), and writes each one with more workers than its kind's pool back with that pool, reading the record again just before and sending its own `network_config`, `custom_provider_config` and raw-payload switches back with it, since the PUT replaces the network block whole. The PUT also creates a record the gateway does not hold, so a write the gateway's store turned away (a 5xx) goes out again only to a record that is still there and still over its pool when read back after the wait, and a write the gateway did not answer is never sent again. A record the process has provisioned is skipped, a provision of a record waits for the pass's write to it once that write is sent, a failed listing is tried again at the next provision, and a record the gateway refuses keeps its pool until the next process. The pass ends with one log line that counts the records it resized, the ones the gateway refused and the ones it could not confirm. A lowered value therefore reaches every record at the backend's first sandbox session or model-endpoint request after a restart; a raised one reaches each record at its next provision.

A prefill also grows with the prompt, which no gateway knob bounds. A managed Claude Code turn therefore compacts its conversation inside the serving model's context window (the catalog `contextWindow`, narrowed by the organization's context limit) whenever that window is below the 200,000 tokens the CLI assumes for a model it does not know (`CLAUDE_CODE_AUTO_COMPACT_WINDOW`, empty otherwise; the CLI treats any value below 100,000 as 100,000). Make the provider catalog report the context the model really serves, or a long turn's prompt can outgrow what a local model prefills within the CLI's own 30-minute stream watchdog.

A local server's prompt cache only helps when consecutive requests share their beginning. Claude Code opens every system prompt with an attribution line whose checksum changes on each request (`x-anthropic-billing-header: …; cch=…;`), which Anthropic's API reads and any other server takes as text. For a model that is not Claude, a managed turn therefore sets `CLAUDE_CODE_ATTRIBUTION_HEADER=0`, and each turn reuses the whole previous prompt instead of recomputing everything after the tool definitions.

A server with several replicas keeps that prefix in one replica's cache, so a balancer that picks a replica by load alone sends later turns of one conversation to a replica that has to prefill it again. A managed Claude Code turn on a model that is not Claude therefore names its exec in every request (`ANTHROPIC_CUSTOM_HEADERS` carries `x-bf-eh-x-tale-cache-affinity: <exec id>`), which the gateway forwards upstream as `X-Tale-Cache-Affinity`; a balancer can hash that header to keep the turn on one replica, and an upstream that ignores it is unaffected.

The pre-rename `LLM_GATEWAY_*` names are still read as a fallback; use the `SANDBOX_LLM_GATEWAY_*` names for new configuration.

Auth + virtual-key enforcement are config-store fields the platform pushes via `applyGatewayConfig()`, not env knobs on this container; the admin password, as its setup token, is the one value the container reads.

## Recover a gateway killed at boot

The gateway starts every stored record's workers while it boots, before it serves HTTP. A store whose records were written with more workers than the pools above (the gateway's own default is 1,000 per record) can need more memory than the container's limit (`mem_limit: 512m` from `tale deploy`, `limits.memory: 512Mi` in the Kubernetes manifest). The gateway is then killed inside its own start-up at every restart (`docker inspect --format '{{.State.OOMKilled}}' <container>` answers `true`), and the backend, which resizes records only through the management API, never reaches it. Do not wipe the volume: it holds the admin account and the minted keys with their spend.

1. Raise the limit until the gateway starts. On a `tale deploy` host, run `docker update --memory 2g --memory-swap 2g <container>` on the container whose name ends in `-sandbox-llm-gateway`; its restart policy starts it again with the new limit. On Kubernetes, raise `resources.limits.memory` on its Deployment.
2. Start a sandbox session or call the model endpoints. The backend's shrink pass resizes every record over its kind's pool and ends with the line `[llm-gateway] provider worker resize finished: <n> resized, <n> refused, <n> unconfirmed`, whatever the counts. A refused or unconfirmed record keeps its workers, and the warning logged before that line names it and what the gateway answered; a write the gateway did not answer within 30 s, or failed, counts as resized when the record read back holds the new pool. Restart the backend services to try unconfirmed records again.
3. Restore the limit with `docker update --memory 512m --memory-swap 1g <container>` (the memory and swap `tale deploy` gives the container) and `docker restart <container>`, or the Deployment's original value, and check that the gateway starts within it.

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
- `docker-entrypoint.sh` — sets `BIFROST_SETUP_TOKEN` to the admin password, whatever the container was given, then runs the upstream entrypoint unchanged.
