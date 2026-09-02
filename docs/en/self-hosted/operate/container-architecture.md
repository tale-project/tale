---
title: Container architecture
description: Which container owns which job in a running Tale instance, the request path of a chat message, and what an outage in each container looks like.
---

A Tale instance is ten containers wired by docker compose. The architecture page covered what each container is for; this page is the operator's version — which container owns which job, how a chat message flows through them, and what the failure mode looks like when one of them dies.

Read this when you are on call. Come back when you are deciding which container to roll first during an upgrade.

## The ten containers, with their jobs

| Container                  | Job                                                                                              | Crashes affect                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `tale-proxy`               | TLS termination + edge routing                                                                   | All ingress — no client can reach the UI                           |
| `tale-platform`            | UI server, static asset delivery, the public `/status` page                                      | Browser sees 502; the API is still reachable                       |
| `backend-api`              | Every application request: auth, the app API, the machine API, WebDAV, the live-update stream, and knowledge search in-process | UI loads, but no data; in-flight chats stall                       |
| `backend-worker`           | Background jobs: document ingest and embedding, web crawling, automation runs, retention sweeps, the cron schedule | The UI keeps working; uploads sit in "indexing" and automations do not fire |
| `tale-db`                  | Postgres — the application database, the job queue, and the knowledge corpus                     | Writes are refused; the app degrades to whatever is already loaded |
| `tale-knowledge-db`        | Knowledge corpus Postgres (document chunks, embeddings, crawled pages)                           | Knowledge search returns empty; ingestion fails                    |
| `tale-object-store`        | The blob store — uploaded documents, chat attachments, audio, generated media                    | Every upload and every download fails; the rest of the app works   |
| `tale-sandbox-llm-gateway` | LLM gateway for harness turns                                                                    | Harness turns can't reach a model; chat is unaffected              |
| `tale-sandbox-egress`      | Network egress for sandboxed code                                                                | `Run code` tool errors with "egress denied"; web render fails      |
| `tale-sandbox`             | Sandbox runtime + headless browser for web render and document generation                        | `Run code`, web crawl render, and document generation all fail     |

`backend-api` and `backend-worker` are the same image as `tale-platform` started in a different role, and both scale independently — `docker compose up -d --scale backend-worker=3` is a supported topology, which is why the shipped compose file gives them no fixed container name. Address them by service name. A `tale deploy` stack names them `<project-id>-backend-api` and `<project-id>-backend-worker`.

`tale-knowledge-db` is its own container in the shipped compose file. A single-host `tale deploy` stack folds the corpus into `tale-db` instead and gives that container the `knowledge-db` network alias, so the same connection string resolves either way — if `tale status` shows no knowledge database, that is why, and `tale-db` is the container to look at.

One container is exposed to the public network (`tale-proxy` for HTTPS, and optionally `tale-sandbox-egress` outbound for the sandbox); the rest are internal-only, including the blob store — blobs reach the browser through presigned URLs that the proxy forwards under the bucket path.

## The request path

A chat message takes one round trip through the containers:

1. Browser → `tale-proxy` (TLS terminated).
2. `tale-proxy` → `tale-platform` for HTML, JS, and the static assets → `backend-api` for everything under `/api/`, plus `/events`, `/dav`, and the machine API.
3. `backend-api` reads the org's provider config, picks the model, opens a stream to the upstream provider, and streams tokens back to the browser over server-sent events.
4. If the agent retrieves knowledge: `backend-api` runs the search in-process, querying the corpus database directly — no separate retrieval service in the path.
5. If the agent runs code: `backend-api` → `tale-sandbox` → `tale-sandbox-egress` for any outbound network.
6. Anything the turn deferred — indexing a new upload, a follow-up automation — commits to the job queue in the same transaction as the write, and `backend-worker` picks it up.

Alongside the token stream the browser holds one long-lived `GET /events` connection to `backend-api`. It carries no data, only invalidation hints: the app refetches the affected query when a hint arrives. A dead hint stream therefore looks like a UI that has stopped updating on its own, not like an outage.

The hot path is short. If chat latency feels wrong, the container to blame is almost always the upstream provider, not Tale; the backend's own request histograms on `/metrics/backend` surface the time spent in each hop.

## The sandbox plane

Sandboxed code execution runs in `tale-sandbox` with `tale-sandbox-egress` as the only network seam. The two-container split is deliberate: `tale-sandbox` itself has no outbound network; every request the sandboxed code makes goes through `tale-sandbox-egress`, which blocks cloud-metadata and private-range targets at the IP layer and — when the operator sets `SANDBOX_EGRESS_ALLOWLIST` — enforces a default-deny hostname allowlist on top. If the egress container is down, sandboxed code that needs the network fails closed with "egress denied" — not a silent timeout.

The sandbox runtime carries Chromium and Playwright, so the backend reuses it for the headless work it cannot do in-process: rendering a JavaScript page during a web crawl, and turning generated HTML into a PDF or image. Those jobs run as ephemeral sandbox executions rather than user code, but they ride the same egress and isolation seam. The sandbox is the only container that runs untrusted-ish code (user-supplied skill scripts, agent `Run code` invocations); the rest of the stack runs the platform's own code.

## Failure modes — what each container's outage looks like

**`tale-proxy` down.** TLS handshake fails; every client sees a connection error. Inside the host, the platform and backend containers are still up — restart proxy first.

**`tale-platform` down.** Browser gets 502 from proxy; the API keeps working. Existing browser tabs with cached assets continue to talk to the backend and may not notice until they reload.

**`backend-api` down.** Browser loads the UI shell but nothing populates, and the public `/status` page reads `outage` — that page's only probe is this tier's `/ping`. Restarting is safe: sessions live in Postgres, and the browser re-establishes its hint stream and refetches on reconnect.

**`backend-worker` down.** Nothing breaks in front of the user, which is what makes this one easy to miss. Requests keep being served, but nothing deferred runs: uploads stay in "indexing", automations do not fire, scheduled sweeps stop. The work is not lost — pg-boss holds the jobs in Postgres and the worker drains the backlog when it comes back. Watch `tale_backend_jobs{state="created"}` climbing on `/metrics/backend`, because the container itself has no healthcheck (it serves no HTTP), so `tale status` will only ever say `running`.

**`tale-db` down.** Every write is refused and most reads with it; sign-in fails, and the job queue stops accepting work. Nothing degrades gracefully here — the database is the store of record for the application, the queue, and the sessions.

**`tale-knowledge-db` down.** Document ingestion fails and knowledge search returns empty — agents that retrieve knowledge get an empty result set and a warning in the execution log. The rest of the app keeps working; chats without knowledge are unaffected. Restarting the container clears it, and in-flight uploads retry on the next pass. On a stack that folded the corpus into `tale-db`, this failure and the one above are the same failure.

**`tale-object-store` down.** Uploading a file fails, and so does opening one already uploaded — a document list still renders from the database, but every download 5xx's. Chat, tasks, and automations that touch no files are unaffected. The store is also where a per-organisation bring-your-own bucket is not involved: an org pointed at its own S3 keeps working while the bundled store is down.

**`tale-sandbox` / `tale-sandbox-egress` down.** `Run code` tool calls return an error and skill scripts fail. Because the backend renders web pages and generates documents through the sandbox runtime, a web crawl that needs JavaScript rendering and document generation also fail closed while the sandbox is down. Agents that use none of these keep working.

**`tale-sandbox-llm-gateway` down.** Harness turns lose their path to a model provider. Regular chat — which calls providers directly from the backend, not through the LLM gateway — is unaffected.

## Where this fits

This page is the operator's map; the [Architecture overview](/self-hosted/overview) is the introduction to the same picture, the [Troubleshooting](/self-hosted/operate/observability/troubleshooting) page is the symptom-first index when something has gone wrong. If you are setting alert thresholds, [Operations](/self-hosted/operate/observability/operations) names the signals worth wiring.
