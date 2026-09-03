---
title: Operations
description: What to alert on, which metrics matter, and the oncall checklist when a Tale instance starts behaving badly.
---

The operations page is the alert playbook — which signals are worth waking someone for, which can ride out a coffee, and what the first five minutes of an incident look like. Tale's metrics surface lives behind `METRICS_BEARER_TOKEN`; this page assumes you have wired up Prometheus and Grafana per [Observability config](/self-hosted/configuration/observability-config) and now need to know which numbers to watch.

The symptom-first index is at [Troubleshooting](/self-hosted/operate/observability/troubleshooting). This page is the proactive side — signals first, oncall checklist second.

## Signals worth alerting on

| Signal                                      | Severity | Why it matters                                      |
| ------------------------------------------- | -------- | --------------------------------------------------- |
| `tale-proxy` health probe failing > 1 min   | page     | Every user sees a connection error                  |
| `tale-platform` HTTP 5xx rate > 5 %         | page     | The UI is broken for a meaningful share of requests |
| `tale-backend-api` down or crash-looping    | page     | UI loads but no data flows                          |
| Postgres connections > 80 % of pool         | warn     | The next spike will start blocking                  |
| `db-data` volume > 80 % full                | warn     | The operational Postgres goes read-only at full     |
| `knowledge-db-data` volume > 80 % full      | warn     | Ingestion fails when the corpus database is full    |
| `knowledge-db` unreachable from the backend | warn     | Knowledge search returns empty; ingestion stalls    |
| Provider request error rate > 20 %          | warn     | The upstream LLM provider is having a bad day       |
| Daily backup did not write                  | page     | Restore drill will fail at the worst moment         |
| TLS cert renewal failed                     | warn     | Renews 30 d before expiry — you have time           |

The first two pages are the actually-customer-impacting ones. The warns are catching trends before they tip into page territory.

## Log signals to grep for

Logs come through stdout per container, captured by Docker's `json-file` driver. The four phrases that consistently mean trouble:

- repeated unhandled-error lines in `tale-backend-api` logs — a backend request-handler crash-loop.
- `decryption failed` in `tale-platform` logs — SOPS age key mismatch with the file on disk.
- `429 Too Many Requests` repeated from a provider — rate limit hit, agents will start failing.
- `connection refused` or `ECONNREFUSED` to `knowledge-db` in `tale-backend-worker` logs — the worker cannot reach the corpus database; ingestion and knowledge search fail.

Pipe these to your aggregator as derived alerts; the metrics endpoints do not surface them as gauges.

## Oncall checklist

When a page lands, the first five minutes follow the same shape every time.

1. **Confirm the alert is real.** Open `$SITE_URL` in a browser. If the UI loads and chat works, you are looking at a metrics or scraper issue, not a customer-impacting one.
2. **Identify the container.** `docker compose ps` shows which is unhealthy; `docker compose logs --tail=200 <service>` shows the last error.
3. **Restart the most-likely culprit.** `docker compose restart <service>` resolves a surprising fraction of incidents — process crashes, file watchers gone stale, exhausted connection pools. The architecture is built to survive a single container restart cleanly.
4. **Check upstream providers.** `https://status.openai.com`, `https://status.anthropic.com`, etc. If the provider is on fire, agents fail; Tale is not the cause.
5. **Page the on-call engineer if the user-visible symptom persists after a restart.** No need to escalate sooner — most incidents resolve in the first three steps.

## What does not need oncall

A `tale-knowledge-db` outage is a warn, not a page. The web-crawl schedule absorbs hours of downtime without user impact, and document ingestion retries rather than dropping work — uploads sit in "indexing" until the corpus database is back. Knowledge search returns empty in the meantime, but chats that do not retrieve knowledge keep working. Catch this in the warn band and fix it in business hours.

## Response-time SLAs

Two response-time budgets are tracked as first-class signals: interactive dialog input and long-running operations such as evaluations. Both are verified as a **mean** over a rolling window — the contractual figure is an average, not a per-request ceiling — and both are wired so Prometheus alerts the moment the average drifts past budget.

| Budget         | Statistic | Target | Window | Underlying series             |
| -------------- | --------- | ------ | ------ | ----------------------------- |
| Dialog input   | mean      | ~1 s   | 30 m   | `tale_dialog_ttft_seconds`    |
| Long operation | mean      | ~40 s  | 6 h    | `tale_long_operation_seconds` |

Each target also rides the platform metrics endpoint as `tale_sla_target_seconds{sla,statistic}`, so a Grafana panel draws the budget line straight from Prometheus instead of hard-coding it. The underlying latency series are the backend's request-duration histograms on `/metrics/backend`; relabel or record them to the names above so the rules resolve. The platform serves the ready-made recording and alerting rules at `/metrics/sla-rules` (behind the same bearer token as the other metrics paths) — fetch it once and reference the file under `rule_files:`, or paste the equivalent:

```yaml
groups:
  - name: tale-sla-recording
    rules:
      - record: tale_sla_dialog_ttft:mean30m
        expr: rate(tale_dialog_ttft_seconds_sum[30m]) / rate(tale_dialog_ttft_seconds_count[30m])
        labels:
          sla: dialog_ttft
      - record: tale_sla_long_operation:mean6h
        expr: rate(tale_long_operation_seconds_sum[6h]) / rate(tale_long_operation_seconds_count[6h])
        labels:
          sla: long_operation
  - name: tale-sla-alerts
    rules:
      - alert: TaleSlaDialogTtftBreached
        expr: tale_sla_dialog_ttft:mean30m > 1
        for: 15m
        labels:
          severity: warn
          sla: dialog_ttft
        annotations:
          summary: 'Dialog input response time: mean response time over 30m exceeds the 1s SLA'
          description: Mean time-to-first-token for an interactive chat / dialog turn.
      - alert: TaleSlaLongOperationBreached
        expr: tale_sla_long_operation:mean6h > 40
        for: 30m
        labels:
          severity: warn
          sla: long_operation
        annotations:
          summary: 'Long operation response time: mean response time over 6h exceeds the 40s SLA'
          description: Mean end-to-end time for long-running operations such as evaluations.
```

A breach here is a **warn**, not a page: a drifting average is a degradation to chase in business hours, and the `for:` windows deliberately wait out a short spike before firing. The ~1 s dialog budget reconciles with the looser ~3 s warm time-to-first-token in the manual performance plan — that ~3 s is a per-request ceiling for a single cold, Auto-routed first token (the first provider SSE text delta) including model and network time, whereas the ~1 s here is the steady-state mean across dialog turns, so occasional first tokens reaching the ceiling are consistent with a sub-second mean. Holding the 1 s mean on live providers may still need the backend-overhead optimization tracked on the feature issue; this alert is what confirms whether the target is met.

## Where this fits

The signals above are the proactive side of operating a Tale instance; the reactive side is [Troubleshooting](/self-hosted/operate/observability/troubleshooting), and the configuration that gets the metrics into Prometheus is [Observability config](/self-hosted/configuration/observability-config). If you have not yet set `METRICS_BEARER_TOKEN`, every threshold above is unmonitored — start there.
