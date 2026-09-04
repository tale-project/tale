---
title: Container architecture
description: Which container owns which job in a running Tale instance, the request path of a chat message, and what an outage in each container looks like.
---

A Tale instance is nine containers wired by docker compose, plus a small video-ingestion sidecar. The architecture page covered what each container is for; this page is the operator's version — which container owns which job, how a chat message flows through them, and what the failure mode looks like when one of them dies.

Read this when you are on call. Come back when you are deciding which container to roll first during an upgrade.

## The containers, with their jobs

| Container                  | Job                                                                            | Crashes affect                                                             |
| -------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `tale-proxy`               | TLS termination + edge routing                                                 | All ingress — no client can reach the UI                                   |
| `tale-platform`            | Web tier: SPA + static assets, branding, the config SSE watch                  | Browser sees the loading page; the API keeps serving cached tabs           |
| `tale-backend-api`         | Every application door: app API, auth, the SSE hint stream, the machine doors  | UI loads, but no data; sign-in, chat, and uploads fail                     |
| `tale-backend-worker`      | Job runner: schedules, agent turns, ingestion, crawling, RAG indexing, doc gen | Chat still answers; background jobs, automations, and ingestion stall      |
| `tale-db`                  | Operational Postgres — the `tale_app` store and the `tale_knowledge` corpus    | Writes block; knowledge search returns empty                               |
| `tale-object-store`        | S3-compatible blob store (uploads, attachments, generated media)               | Every upload and download fails; existing chats without files keep working |
| `tale-sandbox-llm-gateway` | LLM gateway for harness turns                                                  | Harness turns can't reach a model; chat is unaffected                      |
| `tale-sandbox-egress`      | Network egress for sandboxed code                                              | `Run code` errors with "egress denied"; web render fails                   |
| `tale-sandbox`             | Sandbox runtime + headless browser for web render and document generation      | `Run code`, web-crawl render, and document generation all fail             |

One container is exposed to the public network (`tale-proxy` for HTTPS); the rest are internal-only. The `tale-bgutil-provider` sidecar is best-effort — its outage only degrades YouTube video-link ingestion.

## The request path

A chat message takes one round trip through the containers:

1. Browser → `tale-proxy` (TLS terminated).
2. `tale-proxy` → `tale-platform` for the SPA shell and assets, → `tale-backend-api` for the app API (`/api/app/*`, `/api/auth/*`) and the `/events` SSE stream.
3. `tale-backend-api` reads the org's provider config, picks the model, and opens a stream to the upstream provider, relaying tokens back over the `/events` SSE lane.
4. If the agent retrieves knowledge: the backend runs the RAG search against `tale-db`'s `tale_knowledge` database directly — no separate retrieval service in the path.
5. If the agent runs code: `tale-backend-api` → `tale-sandbox` → `tale-sandbox-egress` for any outbound network.
6. Heavier work an agent turn spins off — document ingestion, generation, a scheduled automation — is picked up by `tale-backend-worker`, not the api.

The hot path is short. If chat latency feels wrong, the culprit is almost always the upstream provider, not Tale; the metrics endpoint on `tale-backend-api` surfaces the time spent in each hop.

## The sandbox plane

Sandboxed code execution runs in `tale-sandbox` with `tale-sandbox-egress` as the only network seam. The two-container split is deliberate: `tale-sandbox` itself has no outbound network; every request the sandboxed code makes goes through `tale-sandbox-egress`, which blocks cloud-metadata and private-range targets at the IP layer and — when the operator sets `SANDBOX_EGRESS_ALLOWLIST` — enforces a default-deny hostname allowlist on top. If the egress container is down, sandboxed code that needs the network fails closed with "egress denied" — not a silent timeout.

The sandbox runtime carries Chromium and Playwright, so the backend reuses it for the headless work it cannot do in-process: rendering a JavaScript page during a web crawl, and turning generated HTML into a PDF or image. Those jobs run as ephemeral sandbox executions rather than user code, but they ride the same egress and isolation seam. The sandbox is the only container that runs untrusted-ish code (user-supplied skill scripts, agent `Run code` invocations); the rest of the stack runs the platform's own code.

## Failure modes — what each container's outage looks like

**`tale-proxy` down.** TLS handshake fails; every client sees a connection error. Inside the host, the platform and backend containers are still up — restart proxy first.

**`tale-platform` down.** The browser gets the proxy's loading page instead of the app shell; the API keeps working. Existing tabs with cached assets keep talking to the backend and may not notice until they reload.

**`tale-backend-api` down.** The browser loads the UI shell but nothing populates, and sign-in, chat, and uploads all fail — this is the container every application request depends on. Both platform colours point at the same api, so this is a single point of failure by design; restarting it is safe (sessions are server-side, clients reconnect the SSE stream).

**`tale-backend-worker` down.** Chat still answers — the api serves it — but scheduled automations, agent task runs, document ingestion, and RAG indexing stall until the worker is back. Jobs are at-least-once, so in-flight work resumes on the next pass rather than being lost. Scale the worker (`--scale backend-worker=N`) when the job queue is the bottleneck.

**`tale-db` down.** Writes block and knowledge search returns empty; the app surfaces "saving failed" toasts on any mutation. This is the one container whose data is not rederivable — restart it first and confirm it comes back healthy before worrying about the rest.

**`tale-object-store` down.** Every upload and every download of a stored file fails; agents that read or write documents error, while chats that touch no files keep working. Restarting the container clears it — the blobs are on the `object-store-data` volume, not in the container.

**`tale-sandbox` / `tale-sandbox-egress` down.** `Run code` tool calls return an error and skill scripts fail. Because the backend renders web pages and generates documents through the sandbox runtime, a web crawl that needs JavaScript rendering and document generation also fail closed while the sandbox is down. Agents that use none of these keep working.

**`tale-sandbox-llm-gateway` down.** Harness turns lose their path to a model provider. Regular chat — which calls providers directly from the backend, not through the LLM gateway — is unaffected.

## When `tale-db` comes back from a crash: the knowledge search index

A hard stop of `tale-db` — a crash, a kill, a host reboot — can leave the knowledge corpus's BM25 search index (pg_search) with a zeroed block. The tables are intact, but every new chunk written to the corpus then crashes the database server ("corrupted page pointers"), the server restarts, and the next indexing job repeats the cycle. The index is derived data, so rebuilding it loses nothing — and the backend performs the rebuild itself.

At boot, every backend container (api and worker) verifies each BM25 index of the knowledge database with `pdb.verify_index` before it serves requests or consumes jobs; an organization's own knowledge database is verified the same way the first time the backend touches it. An advisory lock on the knowledge database makes one container repair while the others skip. What happens next depends on the index size:

- Up to `KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES` (default 1 GiB): the container rebuilds the index right there (`REINDEX INDEX`) and verifies it again before it goes on. Boot is delayed by the rebuild — seconds for a small corpus.
- Larger: boot continues, a background job rebuilds the index without blocking reads (`REINDEX INDEX CONCURRENTLY`), and documents uploaded in the meantime get the reason "index rebuilding" in their indexing status instead of crashing the database. They are re-queued automatically once the rebuilt index verifies.

The backend logs the whole sequence; this is what a repaired index looks like in `docker logs tale-backend-api`:

```text
[knowledge] the deployment-default knowledge database: BM25 index private_knowledge.idx_pk_chunks_bm25 is unhealthy (2.9 MB) — rebuilding it now: pdb.verify_index raised: assertion `left == right` failed
[knowledge] the deployment-default knowledge database: rebuilt BM25 index private_knowledge.idx_pk_chunks_bm25 (2.9 MB, inline, 96 ms) — re-verified healthy (4 checks)
```

Every repair — and every rebuild that did not restore health — also writes an audit-log row (actor `system`; action `knowledge_index_repaired`, `knowledge_index_rebuild_scheduled`, or `knowledge_index_repair_failed`) and rings the admin bell of every organization whose corpus lives in that database. A repair is one attempt per index per container start: when the rebuilt index still fails verification, the backend stops, refuses writes to that corpus with a clear error, and the bell says so — rebuild the index by hand (`REINDEX INDEX private_knowledge.idx_pk_chunks_bm25` on the `tale_knowledge` database) or restore the database from a backup. Repeated repairs after restarts point at how the container is being stopped; `KNOWLEDGE_INDEX_REPAIR_DISABLED=1` switches the check off entirely.

## Where this fits

This page is the operator's map; the [Architecture overview](/self-hosted/overview) is the introduction to the same picture, the [Troubleshooting](/self-hosted/operate/observability/troubleshooting) page is the symptom-first index when something has gone wrong. If you are setting alert thresholds, [Operations](/self-hosted/operate/observability/operations) names the signals worth wiring.
