---
title: Status page
description: Every Tale deployment serves its own status page and a JSON twin for monitors — what they report, how to poll them, and where the deeper operational signal lives.
---

Every Tale deployment answers the question "is it just me?" itself. The platform serves a status page without sign-in at `https://<your-host>/status`, and the same verdict as JSON at `https://<your-host>/status.json` for an uptime monitor to poll. The page renders a server-side health summary — operational, degraded, or outage — from two probes against the backend: its liveness, and its own verdict on the data stores it depends on. An operator or an end user can read availability without a login.

Read this when something is misbehaving and you want to know whether the deployment is up, or when you are wiring a monitor that should react to a Tale outage before your connector's own retries give up.

## A worked poll

```bash
curl -sS https://your-host.example.com/status.json
# → { "status": "operational", "checkedAt": "2026-09-12T05:45:20.921Z",
#     "components": [ { "id": "backend", "status": "operational" },
#                     { "id": "database", "status": "operational" },
#                     { "id": "object-store", "status": "operational" } ] }
```

Poll it from your monitor at the cadence you poll everything else; it costs no API budget and needs no key, and the verdict is cached for five seconds, so a tight poll does not turn into a probe storm. The HTML page at `/status` is the same verdict for a person. `GET /api/health` is the cheaper liveness probe the container health check uses — `{"status":"ok","version":"<build>"}`, no sign-in — and the one to use when all you need is "the process answers".

The JSON answers `Access-Control-Allow-Origin: *`, so a browser dashboard can poll it directly without a proxy; `OPTIONS` on either door answers **204** with `Allow: GET, HEAD, OPTIONS`, and `HEAD` answers the headers alone. The HTML page carries no CORS header — a person opens it directly.

## The JSON

The document has three fields, and the vocabulary is closed — branch on these spellings:

- `status` — the overall verdict: `operational` when every component is up, `outage` when every component is down, `degraded` in between.
- `checkedAt` — when the probes last ran, ISO 8601 in UTC.
- `components` — one entry per component, always in this order, each `{ "id", "status" }` with `status` either `operational` or `outage`:
  - `backend` — the application tier that serves every request; every other row depends on it, so a backend that is down takes them all down with it.
  - `database` — the application database and the deployment's knowledge database, folded into one row: either unreachable reads as down.
  - `object-store` — the deployment's file store, where documents and uploads live.

A new component id is an additive change: read the ids you know and treat one you do not as opaque. The set of `status` spellings does not grow without a note in the [release notes](/self-hosted/operate/release-notes/format).

## What the verdict covers

The summary reports the availability of the deployment itself: whether the backend answers, and whether the data stores it depends on do — the backend probes its own database, knowledge database and object store once every thirty seconds and reports the result, so a wedged database or an unreachable bucket shows as a `degraded` verdict with the failing row marked while the backend itself stays green. It does not report the health of the model providers an organization has connected — a provider outage surfaces on the turn that needed it, as the `errorCode` the [API reference](/develop/api-reference) describes — nor security advisories, which have their own [feed](/self-hosted/operate/security/advisories).

## Deeper signal

For operational detail — container health from `tale status`, request metrics from the Caddy logs, and control-plane events in the in-product audit log — the [observability troubleshooting page](/self-hosted/operate/observability/troubleshooting) maps symptoms to logs.

## Tale Cloud

Tale Cloud deployments serve the same `/status` and `/status.json` on their own host. No separate public status host is published at this time; when one is, this page will name it and its subscription feed.

## Where this fits

The status page is the operational channel; [Trust and compliance](/cloud/trust-and-compliance) is the audit channel. If you are reading this because something in your connector is failing right now, the [API reference](/develop/api-reference) lists the error codes you should branch on, and [Rate limits](/develop/rate-limits) explains the 429 that is not an outage.
