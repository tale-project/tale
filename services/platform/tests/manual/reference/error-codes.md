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

## Agent run diagnostics

These bounded diagnostics belong to the failed agent node or task run when a
vision polyfill is required. A serving model proven to support native vision
retains its direct image-reading path without consulting the polyfill policy.
Diagnostics do not contain provider responses, endpoint values or credentials.
Correct the configuration or restore the service, then explicitly retry the run.

| Failure | Provocation and recovery |
|---|---|
| `VISION_MODEL_POLICY_INVALID` | Supply a malformed `vision_model` policy for a text-only or unknown serving target in an isolated test. Configure both `providerSlug` and `modelId`, or explicitly choose Auto. No polyfill is selected before this refusal. |
| `VISION_MODEL_POLICY_UNAVAILABLE` | Make the policy read fail, corrupt its stored file, or remove access to the configured root/organization. Restore valid governance configuration; a real absent policy file in an available root still means Auto, but a cached earlier value cannot bypass this fresh read. |
| `VISION_MODEL_UNAVAILABLE` | Pin a missing/non-vision model, remove its provider or active gateway credential, or exclude it from the credential allowlist. Restore the exact pin's serving prerequisites. A text-only turn cannot substitute another provider or proceed without the required polyfill. |
| `VISION_MODEL_RESOLUTION_FAILED` | Make the explicitly pinned provider, credential or catalog resolver fail. Restore that service and retry; its private response is not copied into the diagnostic. |

## Unreachable from the UI, still enforced

| Guard | Guarded by | Proven by |
|---|---|---|
| Organization workload total must fit current deployment capacity | Live total validation and disabled Save; the server checks the spawner independently before saving | Backend policy-save checks in [automation.md](automation.md) |
