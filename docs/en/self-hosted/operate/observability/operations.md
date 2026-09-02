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
| `tale-platform` health probe failing        | page     | The UI stops loading; the proxy answers 502         |
| `backend-api` HTTP 5xx rate > 5 %           | page     | Every request the app makes goes through this tier  |
| Postgres connections > 80 % of pool         | warn     | The next spike will start blocking                  |
| `db-data` volume > 80 % full                | warn     | The operational Postgres goes read-only at full     |
| `knowledge-db-data` volume > 80 % full      | warn     | Ingestion fails when the corpus database is full    |
| `tale-knowledge-db` unreachable             | warn     | Knowledge search returns empty; ingestion stalls    |
| `tale_backend_jobs{state="created"}` rising | warn     | The worker has stalled; nothing deferred is running |
| `tale_backend_jobs{state="failed"}` growing | warn     | Jobs are exhausting their retries                   |
| `tale-object-store` health probe failing    | page     | No file can be uploaded or opened                   |
| Provider request error rate > 20 %          | warn     | The upstream LLM provider is having a bad day       |
| Daily backup did not write                  | page     | Restore drill will fail at the worst moment         |
| TLS cert renewal failed                     | warn     | Renews 30 d before expiry — you have time           |

The pages are the actually-customer-impacting ones. The warns are catching trends before they tip into page territory.

The 5xx rate comes from `tale_backend_http_requests_total{status="5xx"}` on `/metrics/backend`. The web tier emits no request series of its own — it serves static files — so its failures are visible as a failing container health probe and as 502s at the proxy, not as a Tale metric.

## Log signals to grep for

Logs come through stdout per container, captured by Docker's `json-file` driver. The backend prefixes its own lines with `[backend]`, and it logs no per-request line at all — requests are metrics, not log entries — so a quiet `backend-api` log is normal. The phrases that consistently mean trouble:

- `[backend] fatal startup error` in `backend-api` or `backend-worker` — the process could not boot. Usually a bad `DATABASE_URL` or a migration that will not apply.
- `[backend] task <name> (job <id>) failed` in `backend-worker` — a background job threw. Repeated for the same task name is the tell that it will exhaust its retries.
- `[backend] pg-boss error` in `backend-worker` — the queue engine itself is unhappy, which usually means Postgres is.
- `decryption failed` in a backend log — SOPS age key mismatch with the file on disk.
- `429 Too Many Requests` repeated from a provider — rate limit hit, agents will start failing.
- `connection refused` or `ECONNREFUSED` to `knowledge-db` in a backend log — the corpus database is unreachable; ingestion and knowledge search fail.

Pipe these to your aggregator as derived alerts; the metrics endpoints do not surface them as gauges.

## Inspecting the job queue

There is no queue UI and no CLI subcommand for jobs. Two doors exist, and both are enough. The gauge `tale_backend_jobs{state}` on `/metrics/backend` is the one to alert on. When you need the detail — which task, which payload — query the queue table directly in the application database:

```bash
docker compose exec db psql -U tale -d tale_app \
  -c "SELECT name, state, count(*) FROM pgboss.job GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20;"
```

`name` is the task identifier, one queue per identifier. A backlog concentrated on one name is a stuck task; a backlog spread across all of them is a stopped worker.

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

Each target also rides the metrics endpoints as `tale_sla_target_seconds{sla,statistic}`, so a Grafana panel draws the budget line straight from Prometheus instead of hard-coding it. The `Underlying series` names above are not emitted directly — derive them from the backend's request histogram `tale_backend_http_request_duration_seconds` with a recording rule, so the SLA aggregation stays correct whichever route class carries the operation. The platform serves the ready-made recording and alerting rules at `/metrics/sla-rules` (behind the same bearer token as the other metrics paths) — fetch it once and reference the file under `rule_files:`, or paste the equivalent:

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
