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

## Must never appear

An unhandled rejection, a React error boundary, a raw backend validation error
rendered as a toast, or any `error`-level console line not on the known-benign
list in [`not-a-finding.md`](not-a-finding.md). There is no repro by definition;
any sighting is a finding.

## Unreachable from the UI, still enforced

| Guard | Guarded by | Proven by |
|---|---|---|
| Organization workload total must fit current deployment capacity | Live total validation and disabled Save; the server checks the spawner independently before saving | Backend policy-save checks in [automation.md](automation.md) |
