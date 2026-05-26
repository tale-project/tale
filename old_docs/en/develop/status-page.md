---
title: Status page
description: The public /status surface — what each component reports, what the rollup means, and how external monitors consume it.
---

Tale exposes a public status surface on every instance, at `/status` (HTML) and `/status.json` (JSON). Both reflect the same probe: a five-second-cached health check against the three internal backends — application, knowledge base, and web & document services — rolled up into a single `operational` / `degraded` / `outage` verdict. The page is for two readers: the operator who wants a single URL to check before reporting an incident, and the external monitoring agent that polls Tale's public surface.

This page is the wire reference: what each field means, what the values can be, and what the page intentionally doesn't tell you. For per-request error rates or AI-provider availability, the observability stack documented at [Operations](/self-hosted/operate/observability/operations) is the right surface.

## Worked example — fetch the status feed

The smallest possible monitor probe is one GET against `/status.json`:

```bash
curl -s https://your-tale-instance.com/status.json
```

When everything is healthy, the response is:

```json
{
  "status": "operational",
  "checkedAt": "2026-05-15T13:45:07.123Z",
  "components": [
    { "id": "convex", "status": "operational" },
    { "id": "rag", "status": "operational" },
    { "id": "crawler", "status": "operational" }
  ]
}
```

Both endpoints respond with `200 OK` and `Cache-Control: public, max-age=5` — even during an outage, so external monitors get a stable response shape rather than a timeout.

## The two endpoints

| Endpoint       | Use                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `/status`      | Human-readable HTML page. Locale picked from `Accept-Language` (English, German, French). No JavaScript, no auto-refresh.        |
| `/status.json` | Machine-readable feed for external monitors — BetterStack, UptimeRobot, Atlassian Statuspage, Datadog Synthetics, anything else. |

Both endpoints share the same probe (a single in-memory cache fronts both) so the HTML page and the JSON feed cannot drift. They only differ in representation.

## Wire shape (`/status.json`)

| Name                  | Type   | Description                                                                                               |
| --------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| `status`              | string | Rollup verdict: `operational` (every component up), `degraded` (some up, some down), `outage` (all down). |
| `checkedAt`           | string | ISO 8601 timestamp of the most recent probe round.                                                        |
| `components`          | array  | Per-component health. The shape and order are stable across versions.                                     |
| `components[].id`     | string | Stable component identifier: `convex`, `rag`, or `crawler`.                                               |
| `components[].status` | string | `operational` or `outage`. There's no per-component `degraded` value today.                               |

The fields are stable across versions: new fields may be added, existing ones won't be renamed or removed. Keyword-based uptime monitors can alert on the case-sensitive substring `"status":"outage"` and trust that match across upgrades.

## What each component covers

The IDs map to subsystems, not to the underlying stack names — a deliberate choice so the public surface stays readable when the stack changes.

| ID        | Covers                                                                                    |
| --------- | ----------------------------------------------------------------------------------------- |
| `convex`  | The application backend (reads, writes, real-time sync). If this is down, the UI is down. |
| `rag`     | The knowledge base — indexing new documents and searching existing ones.                  |
| `crawler` | Web & document services — site crawls and on-demand URL fetches.                          |

The rollup is binary at the component level: each subsystem is either reachable and serving (`operational`) or not (`outage`). A future per-component `degraded` value (e.g. latency-based) can land without breaking consumers, because `status` already accepts the wider `OverallStatus` vocabulary.

## How the probe works

A single probe round fans out three HTTP requests in parallel — one to each backend health endpoint — with a 2-second per-probe timeout. The result is cached for five seconds in process memory, so an unauthenticated `/status` route can't be turned into a probe amplifier by a hostile caller. Only the HTTP status of each upstream is inspected; response bodies are discarded immediately, so a misbehaving upstream can't push bytes into the public response.

The platform process itself is implicit in the rollup: if `/status` is responding at all, the platform is reachable. `outage` therefore means every backend probe failed — which is what users effectively see, since none of the user-facing flows work without at least one of the three.

## What's not on the page

`/status` is a coarse-grained surface — "is the platform reachable" — not a metric-level health view. It doesn't report:

- **Per-request error rates.** Use the Sentry stack documented at [Operations](/self-hosted/operate/observability/operations).
- **AI-provider availability.** The provider's own status page is the authoritative source for that.
- **Queue depth, latency histograms, or per-tenant metrics.** Those live in the Prometheus endpoints, also covered under Operations.
- **Internal-only services.** The database, the proxy, the background workers — their failure modes route through one of the three named components anyway, so exposing them separately would add noise without information.

## What to scrape

For an external uptime monitor, GET `/status.json` on the interval that suits the alert window — 1–5 minutes is typical. The response is small (~500 bytes) and the endpoint is unauthenticated; it intentionally doesn't gate behind sign-in so monitors can reach it without provisioning credentials.

For internal alerting that goes deeper than the rollup, scrape the Prometheus endpoints documented at [Operations](/self-hosted/operate/observability/operations) instead. `/status` is the URL you put in an incident channel; Prometheus is the URL Grafana queries.

## Where this fits

The status page is the lightest-weight operator surface — the URL someone hits before reporting an incident, the endpoint a third-party monitor polls. The API counterpart to this page is the rest of [API reference](/develop/api-reference); the deeper observability stack for self-hosted operators lives at [Operations](/self-hosted/operate/observability/operations), and the in-app communication channel for upgrades and known issues is [What's new](/platform/admin/whats-new).
