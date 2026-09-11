# Error-surface provocation map

Which error each surface can produce, and how to reach it deliberately. Used by
the suites when a box says "expect the error state", and as the checklist for
"should this even be reachable from here?".

Add a row when a new error becomes reachable, with the shortest path that
provokes it and the recovery the surface offers.

## Reachable from the UI

| Surface | How to reach it |
|---|---|
| Sandbox limits exceed deployment capacity (`sandboxes.limits.totalExceedsDeployment`) | In Settings > Sandboxes, edit the three limits so their total exceeds deployment capacity. The total and error update; saving stays blocked until the total fits. If the operator lowers capacity after the page loads, saving also catches the new limit. |
| Sandbox deployment capacity unavailable (`sandboxes.limits.capacityUnavailable`) | In a disconnected sandbox-service test stack, raise a limit in Settings > Sandboxes so the total grows. The page explains that lowering still saves and that infrastructure data must be refreshed before raising; reconnect and use Refresh. Lowering a limit in that state saves normally. |

## Reachable on the API surface only

Never a rendered message — seeing one of these in the UI is itself a bug.

| Failure | Where it shows up |
|---|---|
| `SANDBOX_QUOTA_EXCEEDS_DEPLOYMENT` (400) | Save a `sandbox_quota` policy whose three limits add up above the spawner's current `maxSessions`. The error data includes `total` and `maxSessions`; the existing policy remains unchanged. The UI renders a localized explanation, never the raw code. |
| `SANDBOX_CAPACITY_UNAVAILABLE` (503) | Save a `sandbox_quota` policy whose total is HIGHER than the saved total while the authoritative deployment capacity cannot be read. A total that does not grow saves without the capacity. The existing policy remains unchanged; retry after the service recovers. |
| `CHAT_MODEL_UNKNOWN` / `CHAT_MODEL_AMBIGUOUS` (400) | `POST /api/v1/threads/{id}/messages` with a `model` that `GET /api/v1/models` does not list, or one listed under two providers with no `providerSlug`. Nothing is queued; the 202 of a good send names the resolved `providerSlug`. |
| `CHAT_TURN_NOT_RUNNING` (404) | `DELETE /api/v1/threads/{id}/generation` while the poll says `idle`. During a turn the same call answers 202 `cancelling`. |
| `CHAT_TURN_IN_PROGRESS` (409) on delete | `DELETE /api/v1/threads/{id}` while a turn runs; cancel the turn first, then the delete answers 204. |
| `KNOWLEDGE_ENTRY_SUPERSEDED` (409) | `PATCH /api/v1/knowledge-entries/{id}` on an entry a newer version replaced; edit the active one. Deleting a superseded entry removes that row only; deleting the active entry removes the chain. |
| `PROJECT_KEY_TAKEN` (409) | `POST /api/v1/projects` with an explicit `key` another project holds. A derived key that collides is re-derived instead. |
| `WEBSITE_DOMAIN_NOT_CRAWLABLE` (400) | `POST /api/v1/websites` naming `localhost`, a link-local or RFC 1918 host, or a cloud metadata address, with `TALE_ALLOW_PRIVATE_CRAWL_HOSTS` unset. |
| `METHOD_NOT_ALLOWED` (405) | Any `/api/v1` route with a verb it does not serve (`DELETE /api/v1/models`), and any verb but `POST` on `/api/v1/mcp`; `Allow` lists the verbs served. |
| `INVALID_BODY` for a NUL byte (400) | Any REST write whose JSON carries `\u0000` in a string; `data.issues` names the field. Used to be a 500 from Postgres. |
| `invalid_token` on OIDC userinfo (401 + `WWW-Authenticate: Bearer`) | `GET /api/auth/oauth2/userinfo` with an expired or made-up bearer token. The token endpoint answers an unknown grant as `unsupported_grant_type`. |

## Must never appear

An unhandled rejection, a React error boundary, a raw backend validation error
rendered as a toast, or any `error`-level console line not on the known-benign
list in [`not-a-finding.md`](not-a-finding.md). There is no repro by definition;
any sighting is a finding.

## Unreachable from the UI, still enforced

| Guard | Guarded by | Proven by |
|---|---|---|
| Organization workload total must fit current deployment capacity | Live total validation and disabled Save; the server checks the spawner independently before saving | Backend policy-save checks in [automation.md](automation.md) |
