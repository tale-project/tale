---
title: Status page
description: Tale's public status page — what it covers, how incidents are scoped per service, where the RSS feed lives, and how the page differs from your self-hosted metrics.
---

The status page is the canonical record of Tale Cloud availability. Each rotatable service has its own status row, incident history is kept for the audit trail, and the page is the channel Tale uses during an incident — before email goes out, before support tickets are answered, the page is updated.

Read this when something is misbehaving and you want to know whether it is just you. Subscribe to the feed when you are responsible for the integration on your side — the page tells you which service degraded so you can route the alert to the right team without waking the wrong on-call.

## A worked subscription

The status page is at `https://status.tale.dev`. Subscribing takes one URL:

```bash
curl -sS https://status.tale.dev/history.rss
```

The RSS feed carries every state change — open, update, resolved — for every service. Email subscription is the same one-click form on the page; the email channel ships the same events with a five-minute debounce.

## Scope per service

| Service    | What it covers                                                                     | When it goes red                                 |
| ---------- | ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| `platform` | The TanStack Start + Convex application — agents, workflows, integrations, UI.     | UI unreachable; API returns 5xx; auth broken.    |
| `rag`      | The Python FastAPI document-processing service — indexing, retrieval.              | Document uploads stall; retrieval is empty.      |
| `crawler`  | The Crawl4AI web-extraction service — used by document ingest and Tavily fallback. | Web-pulled documents fail; deep research stalls. |
| `proxy`    | The Caddy edge — TLS termination, HTTP routing.                                    | All Tale Cloud traffic affected.                 |
| `db`       | TimescaleDB — durable state for the Convex layer and platform metadata.            | Writes refused; the platform row also goes red.  |

Each row carries the last 90 days of uptime as a sparkline. An incident reads as a coloured band on the row; clicking the band opens the timeline — first update, follow-ups, resolution, post-mortem when one is owed.

## Incident history

History is kept indefinitely. Each incident records the affected services, the customer impact statement, the timeline, and the post-mortem when the incident crosses the severity threshold that obliges one. The threshold is published on the page itself; the rule of thumb is anything with cross-org customer impact and a duration above 30 minutes.

The page is owned by the on-call rotation. Updates are pushed by the engineer holding the page, not by an automated system — the choice is deliberate, because the page is also the document that goes to customers and auditors after the fact.

## Self-hosted: what changes

Self-hosted instances do not appear on Tale's status page — the page covers Tale Cloud only. For your own deployment, the observability surface inside the platform is the right channel: container health from `tale status`, request metrics from the Caddy logs, and the in-product audit log for control-plane events. The [observability troubleshooting page](/self-hosted/operate/observability/troubleshooting) maps symptoms to logs.

If you operate a self-hosted instance and want a customer-facing status page, run one of the open-source status-page projects against your own probes — Tale does not ship one for self-hosted operators today.

## Where this fits

The status page is the operational channel; [Trust and compliance](/cloud/trust-and-compliance) is the audit channel and lists the page as evidence for the infrastructure-availability control. If you are wiring Tale into a pipeline and need the integration to react to a Tale outage, the RSS feed is the input; if you are reading this because something in your integration is failing right now, [API reference](/develop/api-reference) lists the error codes you should branch on.
