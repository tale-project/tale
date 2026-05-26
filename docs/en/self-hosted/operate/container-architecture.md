---
title: Container architecture
description: Which container owns which job in a running Tale instance, the request path of a chat message, and what an outage in each container looks like.
---

A Tale instance is eight containers wired by docker compose. The architecture page covered what each container is for; this page is the operator's version — which container owns which job, how a chat message flows through them, and what the failure mode looks like when one of them dies.

Read this when you are on call. Come back when you are deciding which container to roll first during an upgrade.

## The eight containers, with their jobs

| Container             | Job                                           | Crashes affect                                |
| --------------------- | --------------------------------------------- | --------------------------------------------- |
| `tale-proxy`          | TLS termination + edge routing                | All ingress — no client can reach the UI      |
| `tale-platform`       | UI server, static asset delivery              | Browser sees 502; the API is still reachable  |
| `tale-convex`         | Backend actions/queries/mutations + WebSocket | UI loads, but no data; in-flight chats stall  |
| `tale-db`             | Postgres for Convex                           | Convex falls back to read-only; writes block  |
| `tale-rag`            | Document indexing + vector retrieval          | Uploads queue; agents lose RAG results        |
| `tale-crawler`        | Website-entity fetching                       | Crawl schedule pauses; existing content stays |
| `tale-sandbox-egress` | Network egress for sandboxed code             | `Run code` tool errors with "egress denied"   |
| `tale-sandbox`        | Sandbox runtime                               | `Run code` tool errors; skill scripts fail    |

Two containers exposed to the public network (`tale-proxy` for HTTPS, optionally `tale-sandbox-egress` outbound for the sandbox); six internal-only.

## The request path

A chat message takes one round trip through five of the containers:

1. Browser → `tale-proxy` (TLS terminated).
2. `tale-proxy` → `tale-platform` for HTML/JS, → `tale-convex` for API + WebSocket.
3. `tale-convex` reads the org's provider config, picks the model, opens a stream to the upstream provider.
4. If the agent retrieves knowledge: `tale-convex` → `tale-rag` for vector search.
5. If the agent runs code: `tale-convex` → `tale-sandbox` → `tale-sandbox-egress` for any outbound network.
6. The provider stream tokens back through `tale-convex` to the browser over the WebSocket.

The hot path is short. If chat latency feels wrong, the container to blame is almost always the upstream provider, not Tale; the metrics endpoints on `tale-convex` and `tale-rag` surface the time spent in each hop.

## The sandbox plane

Sandboxed code execution runs in `tale-sandbox` with `tale-sandbox-egress` as the only network seam. The two-container split is deliberate: `tale-sandbox` itself has no outbound network; every request the sandboxed code makes goes through `tale-sandbox-egress`, which applies the [run-code policy](/platform/admin/governance/run-code-policy) allowlist before letting it through. If the egress container is down, sandboxed code that needs the network fails closed with "egress denied" — not a silent timeout.

The sandbox is the only container that runs untrusted-ish code (user-supplied skill scripts, agent `Run code` invocations). The rest of the stack runs the platform's own code.

## Failure modes — what each container's outage looks like

**`tale-proxy` down.** TLS handshake fails; every client sees a connection error. Inside the host, the platform and convex containers are still up — restart proxy first.

**`tale-platform` down.** Browser gets 502 from proxy; the API keeps working. Existing browser tabs with cached assets continue to talk to convex over the WebSocket and may not notice until they reload.

**`tale-convex` down.** Browser loads the UI shell but nothing populates. WebSocket reconnects loop. Restarting convex is safe — sessions are server-side; clients re-subscribe on reconnect.

**`tale-db` down.** Convex enters its degraded mode: reads from cache, writes are queued. Long outages eventually surface as "saving failed" toasts.

**`tale-rag` down.** Uploads stay in the "indexing" state; agents that try to retrieve knowledge get an empty result set and a warning in the execution log. Restarting rag drains the queue.

**`tale-crawler` down.** Website-entity refresh stops. Existing crawled content stays available. No user-visible impact for hours; the crawler's schedule absorbs short outages.

**Sandbox containers down.** `Run code` tool calls return an error; skill scripts fail. Agents that don't use either keep working.

## Where this fits

This page is the operator's map; the [Architecture overview](/self-hosted/overview) is the introduction to the same picture, the [Troubleshooting](/self-hosted/operate/observability/troubleshooting) page is the symptom-first index when something has gone wrong. If you are setting alert thresholds, [Operations](/self-hosted/operate/observability/operations) names the signals worth wiring.
