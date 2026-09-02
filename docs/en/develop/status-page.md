---
title: Status page
description: Tale's public status page — what it covers, how incidents are scoped per service, where the RSS feed lives, and how the page differs from your self-hosted metrics.
---

The status page is the canonical record of Tale Cloud availability. Each rotatable service has its own status row, incident history is kept for the audit trail, and the page is the channel Tale uses during an incident — before email goes out, before support tickets are answered, the page is updated.

Read this when something is misbehaving and you want to know whether it is just you. Subscribe to the feed when you are responsible for the connector on your side — the page tells you which service degraded so you can route the alert to the right team without waking the wrong on-call.

## A worked subscription

The status page is at `https://status.tale.dev`. Subscribing takes one URL:

```bash
curl -sS https://status.tale.dev/history.rss
```

The RSS feed carries every state change — open, update, resolved — for every service. Email subscription is the same one-click form on the page; the email channel ships the same events with a five-minute debounce.

## Scope per service

| Service    | What it covers                                                                     | When it goes red                                 |
| ---------- | ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| `platform` | The TanStack Start UI server and the Node backend behind it — agents, workflows, connectors, UI. | UI unreachable; API returns 5xx; auth broken.    |
| `rag`      | The Python FastAPI document-processing service — indexing, retrieval.                            | Document uploads stall; retrieval is empty.      |
| `crawler`  | The Crawl4AI web-extraction service — used by document ingest and Tavily fallback.               | Web-pulled documents fail; deep research stalls. |
| `proxy`    | The Caddy edge — TLS termination, HTTP routing.                                                  | All Tale Cloud traffic affected.                 |
| `db`       | Postgres — durable application state and the background job queue.                              | Writes refused; the platform row also goes red.  |

Each row carries the last 90 days of uptime as a sparkline. An incident reads as a coloured band on the row; clicking the band opens the timeline — first update, follow-ups, resolution, post-mortem when one is owed.

## Incident history

History is kept indefinitely. Each incident records the affected services, the customer impact statement, the timeline, and the post-mortem when the incident crosses the severity threshold that obliges one. The threshold is published on the page itself; the rule of thumb is anything with cross-org customer impact and a duration above 30 minutes.

The page is owned by the on-call rotation. Updates are pushed by the engineer holding the page, not by an automated system — the choice is deliberate, because the page is also the document that goes to customers and auditors after the fact.

## Self-hosted: what changes

Self-hosted instances do not appear on `status.tale.dev` — that page covers Tale Cloud. Each deployment ships its own status page instead, served by the platform and reachable without signing in at `https://<your-host>/status`. It renders a server-side health summary — operational, degraded, or outage — from a liveness probe against the backend tier's own `/ping` route, the same route the `backend-api` container's healthcheck uses. So an operator (or an end user checking whether it is just them) can read availability without a login. The machine-readable form is `https://<your-host>/status.json`, which returns the same result as JSON for an uptime monitor to poll.

The probe reports one component, `backend`, because that tier serves every request the app makes: if it answers, data flows. The platform container's own liveness is implicit — the status page could not have rendered otherwise. Results are cached for five seconds and each probe times out after two, so pointing an uptime monitor at `/status.json` on a tight interval costs the backend almost nothing.

That page reports the availability of the deployment itself. For deeper operational signal — container health from `tale status`, request metrics from the Caddy logs, and control-plane events in the in-product audit log — the [observability troubleshooting page](/self-hosted/operate/observability/troubleshooting) maps symptoms to logs.

## Where this fits

The status page is the operational channel; [Trust and compliance](/cloud/trust-and-compliance) is the audit channel and lists the page as evidence for the infrastructure-availability control. If you are wiring Tale into a pipeline and need the connector to react to a Tale outage, the RSS feed is the input; if you are reading this because something in your connector is failing right now, [API reference](/develop/api-reference) lists the error codes you should branch on.
