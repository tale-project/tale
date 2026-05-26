---
title: Operations
description: What to alert on, which metrics matter, and the oncall checklist when a Tale instance starts behaving badly.
---

The operations page is the alert playbook — which signals are worth waking someone for, which can ride out a coffee, and what the first five minutes of an incident look like. Tale's metrics surface lives behind `METRICS_BEARER_TOKEN`; this page assumes you have wired up Prometheus and Grafana per [Observability config](/self-hosted/configuration/observability-config) and now need to know which numbers to watch.

The symptom-first index is at [Troubleshooting](/self-hosted/operate/observability/troubleshooting). This page is the proactive side — signals first, oncall checklist second.

## Signals worth alerting on

| Signal                                    | Severity | Why it matters                                      |
| ----------------------------------------- | -------- | --------------------------------------------------- |
| `tale-proxy` health probe failing > 1 min | page     | Every user sees a connection error                  |
| `tale-platform` HTTP 5xx rate > 5 %       | page     | The UI is broken for a meaningful share of requests |
| `tale-convex` WebSocket reconnect storm   | page     | UI loads but no data flows                          |
| Postgres connections > 80 % of pool       | warn     | The next spike will start blocking                  |
| `db-data` volume > 80 % full              | warn     | Postgres goes read-only at full                     |
| RAG indexing queue depth > 100 for 10 min | warn     | Uploads stuck in "indexing"                         |
| Provider request error rate > 20 %        | warn     | The upstream LLM provider is having a bad day       |
| Daily backup did not write                | page     | Restore drill will fail at the worst moment         |
| TLS cert renewal failed                   | warn     | Renews 30 d before expiry — you have time           |

The first two pages are the actually-customer-impacting ones. The warns are catching trends before they tip into page territory.

## Log signals to grep for

Logs come through stdout per container, captured by Docker's `json-file` driver. The four phrases that consistently mean trouble:

- `panic` or `unexpected error` in `tale-convex` logs — Convex action crash.
- `decryption failed` in `tale-platform` logs — SOPS age key mismatch with the file on disk.
- `429 Too Many Requests` repeated from a provider — rate limit hit, agents will start failing.
- `connection refused` from `tale-rag` or `tale-crawler` — the platform cannot reach a sibling container.

Pipe these to your aggregator as derived alerts; the metrics endpoints do not surface them as gauges.

## Oncall checklist

When a page lands, the first five minutes follow the same shape every time.

1. **Confirm the alert is real.** Open `$SITE_URL` in a browser. If the UI loads and chat works, you are looking at a metrics or scraper issue, not a customer-impacting one.
2. **Identify the container.** `docker compose ps` shows which is unhealthy; `docker compose logs --tail=200 <service>` shows the last error.
3. **Restart the most-likely culprit.** `docker compose restart <service>` resolves a surprising fraction of incidents — process crashes, file watchers gone stale, exhausted connection pools. The architecture is built to survive a single container restart cleanly.
4. **Check upstream providers.** `https://status.openai.com`, `https://status.anthropic.com`, etc. If the provider is on fire, agents fail; Tale is not the cause.
5. **Page the on-call engineer if the user-visible symptom persists after a restart.** No need to escalate sooner — most incidents resolve in the first three steps.

## What does not need oncall

`tale-crawler` and `tale-rag` outages are not pages. The crawler's schedule absorbs hours of downtime without user impact; uploads to RAG queue rather than fail. Catch these in the warn band and fix them in business hours.

## Where this fits

The signals above are the proactive side of operating a Tale instance; the reactive side is [Troubleshooting](/self-hosted/operate/observability/troubleshooting), and the configuration that gets the metrics into Prometheus is [Observability config](/self-hosted/configuration/observability-config). If you have not yet set `METRICS_BEARER_TOKEN`, every threshold above is unmonitored — start there.
