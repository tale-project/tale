---
title: Troubleshooting
description: Symptom-first index for the issues operators have actually hit on Tale instances — what the user reports, what is broken, and what to do about it.
---

This page is the symptom-first lookup when something is wrong right now. Each section starts with what the user actually reports — what the browser shows, what the agent fails on, what the upload screen says — and walks back to the cause and the fix. Anything not listed here is a candidate for a new section once it has shown up twice.

The proactive side — signals worth alerting on, what to wire into Prometheus — lives in [Operations](/self-hosted/operate/observability/operations). This page is for the moment after the page fired.

## Browser sees 502 or "Bad Gateway"

The `tale-proxy` container reached the platform, but the platform did not reply. Either `tale-platform` is down or its health endpoint is unreachable. Check container state first:

```bash
docker compose ps tale-platform
docker compose logs --tail=200 tale-platform
```

If the container is restarting, the logs at the bottom show the crash reason — usually a misconfigured env var (`SITE_URL` mismatch, missing `BETTER_AUTH_SECRET`) or a Postgres connection failure. Fix the env, restart, retry. If the container is healthy but the browser still sees 502, the proxy is the suspect — `docker compose restart tale-proxy` clears most of these.

## Browser sees a TLS warning

`TLS_MODE=selfsigned` is the most common cause — the browser does not trust Caddy's internal CA on first visit. Either trust the CA on the host (`docker exec tale-proxy caddy trust`) or switch to `TLS_MODE=letsencrypt` for a real certificate. The full mode walk lives in [TLS and domains](/self-hosted/configuration/tls-and-domains).

If the mode is already `letsencrypt`, check the proxy logs for ACME failures — DNS not resolving to this host's public IP and port 80 unreachable from the public Internet are the two common causes.

## UI loads but no data appears

The UI shell is static assets served by `tale-platform`; everything else flows through `tale-backend-api` — the app API over HTTP and the live-update SSE stream on `/events`. When the backend cannot be reached, the shell loads and stays empty. Symptoms: spinners that never resolve, "reconnecting" toasts, the chat input that never accepts a message.

```bash
docker compose logs --tail=200 backend-api
```

The backend-api container is probably restarting (look for a crash in the logs) or unreachable from the proxy. Restart with `docker compose restart backend-api` — sessions are server-side and clients reconnect the SSE stream, so the restart is safe.

## Uploads stuck in "indexing"

Document ingestion runs inside the backend worker and writes the extracted chunks and embeddings to the knowledge corpus database. A long "indexing" state means either the worker cannot reach the corpus database or the file itself failed to extract. Check the worker logs and the corpus database first:

```bash
docker compose logs --tail=200 backend-worker | grep -iE "knowledge|ingest|embed"
docker compose ps db
```

If the logs show connection errors to the corpus database (`knowledge-db` on the network, folded into `db` on a single-host deploy), restart it (`docker compose restart db`); ingestion retries on the next pass, so uploads do not have to be re-submitted. If the database is healthy but a specific upload is stuck, the file itself is the suspect — corrupt PDFs and password-protected documents land in a failure state and require deletion and re-upload.

## Chat replies stop mid-stream

The token stream from the upstream provider dropped — either the provider rate-limited, the connection timed out, or the provider's service is degraded. Check the provider's status page first; then look in the platform logs:

```bash
docker compose logs --tail=200 tale-platform | grep -E "429|503|stream"
```

A `429` is the common case. Either the org's budget is hitting the provider's rate limit, or the provider key itself is throttled. Switching the org's default model to a less-loaded provider clears the symptom while the upstream cools off.

## Saving fails with "saving failed" toast

The backend could not write to Postgres. Either `tale-db` is down or its disk is full:

```bash
docker compose ps tale-db
docker compose exec db df -h /var/lib/postgresql/data
```

A disk at 100 % is the failure that produces the most surprised faces. Free space, restart `tale-db`, and the queued writes flush. If the disk has room, the suspect is connection-pool exhaustion or a lock — restart `backend-api` to clear the pool.

## "Run code" tool errors with "egress denied"

The `tale-sandbox-egress` container is the only outbound network path for sandboxed code; if it is down or misconfigured, every outbound request from the sandbox fails closed. Check the egress container first:

```bash
docker compose ps tale-sandbox-egress
docker compose logs --tail=100 tale-sandbox-egress
```

If the container is healthy and you have set `SANDBOX_EGRESS_ALLOWLIST`, the request hit the allowlist — extend the variable in `.env` and recreate `tale-sandbox-egress`. Without an allowlist the proxy is open at the hostname layer, so check the target instead: only port 443 is tunnelled for HTTPS, and cloud-metadata and private-range addresses are always blocked at the IP layer.

## Sign-in loops back to the sign-in screen

`SITE_URL` does not match what the browser actually requested. Auth cookies are scoped to the URL the request landed on; a mismatch (trailing slash, missing port, `http` vs `https`, base-path prefix) means the cookie set on the callback does not get sent on the next request.

Fix `.env`:

```bash
SITE_URL=https://tale.example.com  # exactly what the user types
```

Recreate the platform container (`docker compose up -d --force-recreate tale-platform`) for the change to land in the rendered HTML.

## Where to get help

Self-hosted instances do not phone home, so support starts with you. The two channels:

- **GitHub Issues** — bugs and reproducible problems. The [tale-project/tale](https://github.com/tale-project/tale/issues) tracker has a template that asks for the diagnostics bundle `tale diagnostics` produces.
- **Discord** — questions, configuration debates, "is this a bug" triage. The invite lives in the repo README.

Reproducible diagnostics make every channel faster. `tale diagnostics` collects sanitised logs, env vars (secrets redacted), and container health into a single archive worth attaching.
