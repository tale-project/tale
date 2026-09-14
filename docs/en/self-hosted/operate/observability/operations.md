---
title: Monitor and respond to incidents
description: Choose actionable health signals, understand the exported metrics, and investigate failures without losing evidence.
---

Monitor the actions people need to complete, as well as the services beneath them. A successful HTTP probe does not prove that sign-in, a file download, a knowledge query, or an automation finishes. Define alert severity from the impact on your deployment and give each alert an owner and a recovery procedure.

[Observability config](/self-hosted/configuration/observability-config) explains the endpoints and access token. [Prometheus and Grafana](/self-hosted/operate/observability/prometheus-grafana) provides a collection example.

## Choose signals with a useful response

| Signal | How to investigate | When to escalate |
| --- | --- | --- |
| Public URL, certificate, or sign-in fails | Check the public path from outside the host, then proxy and backend logs. | Users cannot reach a required service, or certificates are near expiry without a working renewal path. |
| Backend 5xx responses rise | Compare `tale_backend_http_requests_total` by `route` and `status` with the affected action. | Errors affect active users or critical integrations. |
| A store becomes unreachable | Inspect `tale_backend_store_up` and the store's own monitoring. | The missing store blocks required data, search, or file access. |
| Queued or failed jobs accumulate | Inspect `tale_backend_jobs{state=...}`, workers, and representative run errors. | The backlog stops clearing or a completion deadline is at risk. |
| Disk or connection headroom shrinks | Use host/database monitoring; these are not all Tale-exported metrics. | Forecast exhaustion early enough to add capacity or resolve the cause. |
| A scheduled backup or copy is missing | Check the backup job, completed manifest, and off-host destination. | Your recovery-point objective is no longer met. |
| Provider requests are throttled or rejected | Read the provider response and affected run; check quota, credentials, and provider status. | Required work fails or waits beyond its allowed delay. |

An 80% disk alert can be a starting point, but growth rate and recovery lead time matter more than one universal percentage. A knowledge outage can be critical for a team whose work depends on retrieval; do not automatically defer it because the UI still loads.

## Choose the right health endpoint

Use these paths on the public origin of a production deployment behind the bundled proxy:

| Path | What a successful response establishes |
| --- | --- |
| `/health` | Caddy answers `OK`. This stays healthy while the platform restarts. |
| `/api/health` | The platform web process answers its liveness request. |
| `/status.json` | The public dependency-status report is available; inspect its component verdicts. Results are cached for five seconds. |
| `/status` | The same availability report in a page for people. |

Check the expected response body as well as the HTTP status. An unrecognized frontend path such as `/healthz` can return the app shell with `200`; that is not a health report. See [Status page](/develop/status-page) for the response contract.

## Understand what the metrics prove

The backend exports process metrics, HTTP response counts and durations, queue counts, in-flight generations, open hint streams, the drain flag, and store reachability. Inspect the actual series from your deployed version before writing an alert against it.

- `tale_backend_store_up` probes the **deployment-default** application database, knowledge database, and bucket. Organization-specific connections need their own monitoring.
- Store probes are cached for 30 seconds. An object-store `403` on the bucket probe counts as reachable: it can mean the key cannot list the bucket. A value of `1` does not prove that a particular object can be uploaded or downloaded.
- `/ready` expresses rollout readiness. It does not incorporate external-store health, so a healthy replica can still depend on an unavailable store.
- The public backend metrics URL can reach different API replicas. Process metrics describe the replica that answered; queue and generation collectors read shared database state. Do not sum shared counts as if every replica owned a separate queue.

Use a controlled end-to-end check for the gaps: sign in with a monitoring account, read a known record, and test the file or knowledge flow your team depends on. Keep that check within a dedicated scope and avoid sends or other external effects.

## Keep latency targets separate from measurements

Tale exports `tale_sla_target_seconds` and a rule template at `/metrics/sla-rules`. The current targets are a 1-second mean time to first token over 30 minutes and a 40-second mean long-operation duration over 6 hours. These are target metadata, not observations or a guarantee that your deployment meets them.

The generated rules expect `tale_dialog_ttft_seconds` and `tale_long_operation_seconds` histograms. The backend does not automatically emit those two latency series. Its HTTP request-duration histogram measures request handling, which is not interchangeable with first-token time or the full duration of queued work. Instrument the actual operation boundaries and confirm samples exist before enabling these rules. An empty query is missing evidence, not a passing latency check.

## Investigate before changing state

1. Record the affected organization, URL or action, error code, time range, and scope of impact. Check whether the symptom is reproducible without changing data.
2. Inspect `tale status` and `tale logs <service>`. For a deployment you manage directly, use the Compose service name with `docker compose ps` and `docker compose logs --tail=200 <service>`.
3. Compare browser network failures with API/worker logs and store or provider health. Preserve relevant logs before a restart rotates or obscures them.
4. Address the identified cause: capacity, connectivity, configuration, credentials, or a failed process. Recreate affected containers when changing environment values; `docker compose restart` keeps their previous environment.
5. Verify the original action and related queued work after recovery. Record any interrupted requests or jobs that need an explicit retry, then update the incident timeline.

Escalate as soon as your incident policy requires it. A restart is a recovery action with possible interruption, not a mandatory diagnostic step or a reason to delay escalation. [Troubleshooting](/self-hosted/operate/observability/troubleshooting) maps common symptoms to narrower checks.
