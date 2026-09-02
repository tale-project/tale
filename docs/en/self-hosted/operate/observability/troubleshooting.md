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

The UI shell is static assets served by `tale-platform`; every request behind it goes to the backend tier. When the backend cannot answer, the shell loads and stays empty. Symptoms: spinners that never resolve, an offline banner, the chat input that never accepts a message.

Confirm it in one request — the public status page probes exactly this tier and needs no login:

```bash
curl -sS https://your-host.example.com/status.json
# → {"status":"outage","checkedAt":"...","components":[{"id":"backend","status":"outage"}]}
docker compose logs --tail=200 backend-api
```

The backend is probably restarting (look for `[backend] fatal startup error`) or unreachable from the proxy. Restart with `docker compose restart backend-api` — sessions live in Postgres and the browser refetches on reconnect, so the restart is safe.

## The UI works but stops updating on its own

Data appears when you reload and then goes stale: someone else's change never shows up, a finished run keeps saying "running". The browser holds one long-lived `GET /events` connection to `backend-api` that carries invalidation hints, and when it drops there is no error to see — the page simply stops being told anything changed.

```bash
curl -sS -H "Authorization: Bearer $METRICS_BEARER_TOKEN" \
  https://your-host.example.com/metrics/backend | grep hint_streams
# tale_backend_hint_streams_open 0
```

Zero open streams with users signed in means the lane is being cut. The usual cause is something between the browser and the backend buffering or timing out a streaming response — a corporate proxy, a CDN, or an added reverse proxy in front of Caddy. Tale's own proxy disables buffering on that path; anything you put in front of it must do the same.

## Uploads stuck in "indexing"

Document ingestion is a background job. `backend-worker` picks it up, extracts the text, embeds it, and writes the chunks and embeddings to the knowledge corpus database. A long "indexing" state therefore has three suspects, in this order: no worker is running, the worker cannot reach the corpus database, or the file itself failed to extract.

Start with the queue, because a stopped worker looks exactly like a slow one:

```bash
docker compose exec db psql -U tale -d tale_app \
  -c "SELECT name, state, count(*) FROM pgboss.job WHERE name LIKE 'rag.%' GROUP BY 1, 2;"
docker compose logs --tail=200 backend-worker | grep -iE "knowledge|ingest|embed|rag"
docker compose ps knowledge-db
```

A backlog in `created` with no `active` rows means the worker is down — start it, and it drains the backlog on its own. If the logs show connection errors to `knowledge-db`, restart the corpus database (`docker compose restart knowledge-db`); ingestion retries on the next pass, so uploads do not have to be re-submitted. If the queue is empty and the database is healthy but one upload is stuck, the file itself is the suspect — corrupt PDFs and password-protected documents land in a failure state and require deletion and re-upload.

## Uploads or downloads fail outright

An upload that never starts, or a document that lists but 5xx's on open, points at the blob store rather than the database. Every file lives in an S3-compatible store, and the browser transfers it directly through a presigned URL the proxy forwards.

```bash
docker compose ps object-store
docker compose logs --tail=100 object-store
```

If the store is healthy, the next suspect is the presigned URL's origin: it is signed against the address the browser uses, so a deployment whose public URL changed without `OBJECT_STORE_PUBLIC_ENDPOINT` (or `SITE_URL`) following it signs URLs the browser cannot reach. An organisation that brought its own bucket is a separate path — check its CORS policy allows your origin for `GET`, `PUT`, and `HEAD`, because the in-app connection test runs server-side and will not catch that.

## Chat replies stop mid-stream

The token stream from the upstream provider dropped — either the provider rate-limited, the connection timed out, or the provider's service is degraded. Check the provider's status page first; then look in the platform logs:

```bash
docker compose logs --tail=200 tale-platform | grep -E "429|503|stream"
```

A `429` is the common case. Either the org's budget is hitting the provider's rate limit, or the provider key itself is throttled. Switching the org's default model to a less-loaded provider clears the symptom while the upstream cools off.

## Saving fails with "saving failed" toast

The backend could not write to Postgres. Either `tale-db` is down or its disk is full:

```bash
docker compose ps db
docker compose exec db df -h /var/lib/postgresql/data
```

A disk at 100 % is the failure that produces the most surprised faces. Free space and restart `db`. Note what a full disk costs here: the database holds the application data, the sessions, and the job queue, so a write refusal stops background work too. If the disk has room, the suspect is connection-pool exhaustion or a lock — restart `backend-api` to clear the pool.

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
