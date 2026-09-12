---
title: Status page
description: Every Tale deployment serves its own status page and a JSON twin for monitors — what they report, how to poll them, and where the deeper operational signal lives.
---

Every Tale deployment answers the question "is it just me?" itself. The platform serves a status page without sign-in at `https://<your-host>/status`, and the same verdict as JSON at `https://<your-host>/status.json` for an uptime monitor to poll. The page renders a server-side health summary — operational, degraded, or outage — from a liveness probe against the backend, so an operator or an end user can read availability without a login.

Read this when something is misbehaving and you want to know whether the deployment is up, or when you are wiring a monitor that should react to a Tale outage before your connector's own retries give up.

## A worked poll

```bash
curl -sS https://your-host.example.com/status.json
# → { "status": "operational", ... }
```

Poll it from your monitor at the cadence you poll everything else; it costs no API budget and needs no key. The HTML page at `/status` is the same verdict for a person. `GET /api/health` is the cheaper liveness probe the container health check uses — `{"status":"ok","version":"<build>"}`, no sign-in — and the one to use when all you need is "the process answers".

## What the verdict covers

The summary reports the availability of the deployment itself: whether the backend answers, and whether the data stores it depends on do. It does not report the health of the model providers an organization has connected — a provider outage surfaces on the turn that needed it, as the `errorCode` the [API reference](/develop/api-reference) describes.

## Deeper signal

For operational detail — container health from `tale status`, request metrics from the Caddy logs, and control-plane events in the in-product audit log — the [observability troubleshooting page](/self-hosted/operate/observability/troubleshooting) maps symptoms to logs.

## Tale Cloud

Tale Cloud deployments serve the same `/status` and `/status.json` on their own host. No separate public status host is published at this time; when one is, this page will name it and its subscription feed.

## Where this fits

The status page is the operational channel; [Trust and compliance](/cloud/trust-and-compliance) is the audit channel. If you are reading this because something in your connector is failing right now, the [API reference](/develop/api-reference) lists the error codes you should branch on, and [Rate limits](/develop/rate-limits) explains the 429 that is not an outage.
