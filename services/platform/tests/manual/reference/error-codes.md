# Error-surface provocation map

Which error each surface can produce, and how to reach it deliberately. Used by
the suites when a box says "expect the error state", and as the checklist for
"should this even be reachable from here?".

**This register starts as a stub.** It was created on 2026-09-08 with the shared
manual-test shape. Fill a row the first time a round has to work out how to
provoke something — that is exactly the knowledge this file exists to keep.

## Reachable from the UI

| Surface | How to reach it |
|---|---|
| <the message a user sees> | <the shortest deliberate path to it> |

## Reachable on the API surface only

Never a rendered message — seeing one of these in the UI is itself a bug.

| Failure | Where it shows up |
|---|---|
| <…> | <the request that produces it> |

## Must never appear

An unhandled rejection, a React error boundary, a raw backend validation error
rendered as a toast, or any `error`-level console line not on the known-benign
list in [`not-a-finding.md`](not-a-finding.md). There is no repro by definition;
any sighting is a finding.

## Unreachable from the UI, still enforced

| Guard | Guarded by | Proven by |
|---|---|---|
| <…> | <the client guard> | <the box that calls the server directly> |
