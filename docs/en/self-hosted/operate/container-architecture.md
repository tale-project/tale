---
title: Container architecture
description: Which container owns which job in a running Tale instance, the request path of a chat message, and what an outage in each container looks like.
---

A Tale instance is eight containers wired by docker compose. The architecture page covered what each container is for; this page is the operator's version — which container owns which job, how a chat message flows through them, and what the failure mode looks like when one of them dies.

Read this when you are on call. Come back when you are deciding which container to roll first during an upgrade.

## The eight containers, with their jobs

| Container                  | Job                                                                                            | Crashes affect                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `tale-proxy`               | TLS termination + edge routing                                                                 | All ingress — no client can reach the UI                       |
| `tale-platform`            | UI server, static asset delivery                                                               | Browser sees 502; the API is still reachable                   |
| `tale-convex`              | Backend actions/queries/mutations + WebSocket, plus in-process RAG, crawling, and document gen | UI loads, but no data; in-flight chats stall; ingestion stalls |
| `tale-db`                  | Operational Postgres for Convex                                                                | Convex falls back to read-only; writes block                   |
| `tale-knowledge-db`        | Knowledge corpus Postgres (document chunks, embeddings, crawled pages)                         | Knowledge search returns empty; ingestion fails                |
| `tale-sandbox-llm-gateway` | LLM gateway for harness turns                                                                  | Harness turns can't reach a model; chat is unaffected          |
| `tale-sandbox-egress`      | Network egress for sandboxed code                                                              | `Run code` tool errors with "egress denied"; web render fails  |
| `tale-sandbox`             | Sandbox runtime + headless browser for web render and document generation                      | `Run code`, web crawl render, and document generation all fail |

One container is exposed to the public network (`tale-proxy` for HTTPS, and optionally `tale-sandbox-egress` outbound for the sandbox); the rest are internal-only.

## The request path

A chat message takes one round trip through the containers:

1. Browser → `tale-proxy` (TLS terminated).
2. `tale-proxy` → `tale-platform` for HTML/JS, → `tale-convex` for API + WebSocket.
3. `tale-convex` reads the org's provider config, picks the model, opens a stream to the upstream provider.
4. If the agent retrieves knowledge: `tale-convex` runs the RAG search in-process, querying `tale-knowledge-db` directly — no separate retrieval service in the path.
5. If the agent runs code: `tale-convex` → `tale-sandbox` → `tale-sandbox-egress` for any outbound network.
6. The provider stream tokens back through `tale-convex` to the browser over the WebSocket.

The hot path is short. If chat latency feels wrong, the container to blame is almost always the upstream provider, not Tale; the metrics endpoints on `tale-convex` (which now carries the RAG and crawl timings as well) surface the time spent in each hop.

## The sandbox plane

Sandboxed code execution runs in `tale-sandbox` with `tale-sandbox-egress` as the only network seam. The two-container split is deliberate: `tale-sandbox` itself has no outbound network; every request the sandboxed code makes goes through `tale-sandbox-egress`, which blocks cloud-metadata and private-range targets at the IP layer and — when the operator sets `SANDBOX_EGRESS_ALLOWLIST` — enforces a default-deny hostname allowlist on top. If the egress container is down, sandboxed code that needs the network fails closed with "egress denied" — not a silent timeout.

The sandbox runtime carries Chromium and Playwright, so the convex backend reuses it for the headless work it cannot do in-process: rendering a JavaScript page during a web crawl, and turning generated HTML into a PDF or image. Those jobs run as ephemeral sandbox executions rather than user code, but they ride the same egress and isolation seam. The sandbox is the only container that runs untrusted-ish code (user-supplied skill scripts, agent `Run code` invocations); the rest of the stack runs the platform's own code.

## Failure modes — what each container's outage looks like

**`tale-proxy` down.** TLS handshake fails; every client sees a connection error. Inside the host, the platform and convex containers are still up — restart proxy first.

**`tale-platform` down.** Browser gets 502 from proxy; the API keeps working. Existing browser tabs with cached assets continue to talk to convex over the WebSocket and may not notice until they reload.

**`tale-convex` down.** Browser loads the UI shell but nothing populates. WebSocket reconnects loop. Restarting convex is safe — sessions are server-side; clients re-subscribe on reconnect.

**`tale-db` down.** Convex enters its degraded mode: reads from cache, writes are queued. Long outages eventually surface as "saving failed" toasts.

**`tale-knowledge-db` down.** Document ingestion fails and knowledge search returns empty — agents that retrieve knowledge get an empty result set and a warning in the execution log. The rest of the app keeps working; chats without knowledge are unaffected. Restarting the container clears it, and in-flight uploads retry on the next pass.

**`tale-sandbox` / `tale-sandbox-egress` down.** `Run code` tool calls return an error and skill scripts fail. Because the convex backend renders web pages and generates documents through the sandbox runtime, a web crawl that needs JavaScript rendering and document generation also fail closed while the sandbox is down. Agents that use none of these keep working.

**`tale-sandbox-llm-gateway` down.** Harness turns lose their path to a model provider. Regular chat — which calls providers directly from convex, not through the LLM gateway — is unaffected.

## Where this fits

This page is the operator's map; the [Architecture overview](/self-hosted/overview) is the introduction to the same picture, the [Troubleshooting](/self-hosted/operate/observability/troubleshooting) page is the symptom-first index when something has gone wrong. If you are setting alert thresholds, [Operations](/self-hosted/operate/observability/operations) names the signals worth wiring.
