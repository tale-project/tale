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

## Knowledge database restarts on every upload

Every document ingestion fails the same way: the corpus database (`knowledge-db`, folded into `db` on a single-host deploy) restarts, the backend worker loses its connection, and the next upload triggers the same restart. The server log — a file under `/var/lib/postgresql/data/log/` inside the container; `docker compose logs` only carries the entrypoint's output — names the failure each time:

```bash
docker compose exec knowledge-db sh -c 'grep -h -E "PANIC|signal 6" /var/lib/postgresql/data/log/*.log | tail -n 4'
```

```text
PANIC:  corrupted page pointers: lower = 0, upper = 0, special = 0
LOG:  server process (PID 4711) was terminated by signal 6: Aborted
```

The BM25 keyword index on `private_knowledge.chunks` holds a page that was never initialised, and a crash-mode stop of the database container is what leaves one behind: the server extends the index file for a write in flight, `SIGKILL` lands before the page is written, and crash recovery has no WAL to replay for it. `tale-db` images up to v0.5.7 stopped Postgres with `SIGTERM`, which Postgres reads as a *smart* shutdown — it waits for every client session to end. A client outside compose holding a connection (a host-side backend, an open `psql`) pushed the stop past the grace period, Docker killed the server, and the next start ran crash recovery. Ordinary tables and indexes survive that; `pg_search` meets the all-zero page on its next write and panics, and Postgres restarts to recover — on every upload.

Confirm the index is the culprit before repairing anything. Open a session on the corpus database — both statements only read:

```bash
docker compose exec knowledge-db psql -U tale -d tale_knowledge
```

```sql
select * from pdb.verify_index('private_knowledge.idx_pk_chunks_bm25');
```

A healthy index passes every check (`passed = t`); a damaged one fails `segment_metadata_valid` or cannot be read at all. To look at the page itself, `pageinspect` prints the header of the index's last page — `0 | 0 | 0` is the never-initialised page, a healthy page reads `24 | 8184 | 8184`:

```sql
create extension if not exists pageinspect;
select lower, upper, special
from page_header(get_raw_page('private_knowledge.idx_pk_chunks_bm25',
  (pg_relation_size('private_knowledge.idx_pk_chunks_bm25') / 8192 - 1)::int));
```

Then rebuild the index. It is derived from `private_knowledge.chunks`, so nothing is lost and nothing has to be re-uploaded:

```sql
REINDEX INDEX private_knowledge.idx_pk_chunks_bm25;
```

Optionally rebuild the vector index as well (it exists once the first embedding has been stored) and reclaim the orphaned tail pages on the table:

```sql
REINDEX INDEX private_knowledge.idx_pk_chunks_embedding_hnsw;
VACUUM private_knowledge.chunks;
```

Ingestion resumes on the worker's next pass. `tale-db` images newer than v0.5.7 stop Postgres with `SIGINT` — the *fast* shutdown that disconnects clients, checkpoints, and exits within seconds even while clients are attached — and `compose.yml` sets `stop_signal: SIGINT` so an older image receives the same signal. Stop the stack with `docker compose stop` or `docker compose down` and let the 60-second grace period run (the tale CLI stops containers the same way); `docker kill` and pulling the host's plug are the two paths that still end in a crash-mode stop.

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
