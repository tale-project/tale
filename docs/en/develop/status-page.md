---
title: Check instance availability
description: Read the public status page, monitor its JSON response and distinguish an outage from a failed operation.
---
Open `/status` on your Tale host to check availability without signing in. Monitors can read the same summary from `/status.json`. The summary covers the backend and deployment stores; it does not prove that every model or organization-specific connection works.

## Poll the status document

Set `TALE_BASE_URL` to the instance URL and request its status:

```bash
curl --fail-with-body --silent --show-error \
  "$TALE_BASE_URL/status.json"
```

Inspect the JSON body, not only the HTTP status. During local verification with an unavailable object store, the endpoint returned HTTP `200` and this degraded result:

```json
{
  "status": "degraded",
  "checkedAt": "2026-09-14T04:31:20.847Z",
  "components": [
    { "id": "backend", "status": "operational" },
    { "id": "database", "status": "operational" },
    { "id": "object-store", "status": "outage" }
  ]
}
```

In this case the app can answer requests and reach its database, while file operations need investigation. A monitor that treats every HTTP `200` as healthy would miss that failure.

## Interpret the components

| Field or component | Meaning |
| --- | --- |
| `status: operational` | All reported components are available. |
| `status: degraded` | Some components are unavailable. |
| `status: outage` | All reported components are unavailable. |
| `checkedAt` | Time of the status check, in UTC. |
| `backend` | Application backend reachability. |
| `database` | Application and deployment knowledge database health, combined. |
| `object-store` | Deployment file-store health. |

Component entries report `operational` or `outage`. If the backend cannot answer, the dependent store rows cannot be established and show as unavailable too. Accept new component IDs without breaking your parser.

## Configure a monitor

The JSON endpoint requires no API key and does not consume an API-key budget. Its result is cached for five seconds; backend store probes refresh separately, so it is a recent summary rather than a fresh storage transaction per poll. Set a request timeout and alert on repeated failures or a non-operational body according to your service needs.

`/status.json` allows cross-origin reads with `Access-Control-Allow-Origin: *`. `HEAD` returns headers without the body and `OPTIONS` advertises `GET, HEAD, OPTIONS`. Use `GET` when your monitor must inspect the component verdict.

## Distinguish liveness from readiness

The production web server’s `/api/health` endpoint is a lightweight process check. It is useful for container liveness, but does not replace the status document’s dependency checks. A development Vite server can proxy that path differently and return `404`; use `/status.json` to inspect the running development app.

A green status does not check an external model’s credit, entitlement or availability. It also does not exercise a full upload, knowledge query, chat turn or automation. Add a controlled end-to-end check for the operation your integration depends on.

## Investigate a failure

For a degraded component, use [Troubleshooting](/self-hosted/operate/observability/troubleshooting) to find the corresponding logs. For a failed API call with healthy instance status, inspect the [API error code](/develop/api-reference#error-model); `429` is a [rate-limit response](/develop/rate-limits), not an instance-outage verdict.

Cloud instances expose the same status paths on their own host. Service incident communication and assurance materials are described in [Trust and compliance](/cloud/trust-and-compliance).
