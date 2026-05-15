---
title: Status page
description: The public /status surface — what each service reports, what the rollup means, and where it fits in the operator's monitoring stack.
---

Tale exposes a public `/status` endpoint on every instance. It returns a small, deterministic JSON document plus an HTML render that summarises the health of the platform's services: which ones are reachable, which ones are degraded, and what the rollup verdict is. The page is for two audiences — the operator running the instance who wants a single URL to check before reporting an incident, and the external integrator who's running a monitoring agent against Tale's public surfaces.

This page covers the contract: what's on the page, what the JSON shape is, what to scrape, and what `/status` does **not** tell you (that's what observability tooling like Prometheus and Sentry are for).

## What's on the page

The page surfaces a rollup verdict at the top — **All systems operational** when every dependent service responds healthy, **Partial outage** when at least one service responds degraded, **Major outage** when at least one service responds unhealthy. Beneath the rollup, a per-service breakdown lists each service in the platform with its current status, the last-checked timestamp, and (on Cloud) a small history of recent incidents.

The verdict refreshes every 30 seconds from the server side; the page polls and re-renders so a long-open tab stays current without a manual refresh.

## JSON shape

The same content is available as machine-readable JSON at `/status.json` — useful for an uptime probe or a status-dashboard aggregator. The shape:

```json
{
  "rollup": "operational",
  "services": [
    {
      "name": "platform",
      "status": "healthy",
      "lastCheckedAt": "2026-04-19T08:30:00Z"
    },
    {
      "name": "rag",
      "status": "healthy",
      "lastCheckedAt": "2026-04-19T08:30:00Z"
    },
    {
      "name": "crawler",
      "status": "degraded",
      "lastCheckedAt": "2026-04-19T08:30:00Z"
    }
  ]
}
```

`rollup` is one of `operational`, `partial_outage`, `major_outage`. Each service entry's `status` is one of `healthy`, `degraded`, `unhealthy`. The shape is stable across versions; new fields may be added but existing ones are not renamed or removed.

## What to scrape

For a third-party monitoring probe, GET `/status.json` on the interval that suits the alert window (1–5 minutes is typical). The response is small (~500 bytes) and the endpoint is unauthenticated; it intentionally doesn't gate behind sign-in so external monitors can reach it.

For an internal alert that goes deeper than the rollup, scrape the Prometheus endpoints documented at [Operations](/self-hosted/operate/observability/operations) instead — `/status` is a coarse-grained surface for "is the platform reachable", not a metric-level health view.

## What's not on the page

`/status` doesn't report per-request error rates, AI-provider availability, or queue depth. It also doesn't expose any internal-only services — the database, the proxy, the background workers — because their failure modes route through one of the user-facing services anyway. For per-request error rates, use the Sentry stack documented in [Operations](/self-hosted/operate/observability/operations); for AI-provider availability, the provider's own status page is the authoritative source.

## Where this fits

The status page is the lightest-weight operator surface — the URL someone hits before they report an incident, the endpoint a third-party monitor polls. For day-to-day observability on a self-hosted instance, [Operations](/self-hosted/operate/observability/operations) covers what to scrape and alert on; for the in-app communication after an upgrade, [What's new](/platform/admin/changelog) is the changelog dialog.
