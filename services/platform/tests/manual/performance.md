# Performance — Manual Test Plan (cross-cutting)

> **Purpose**: Spot-check the load and interaction budgets — cold load to first
> paint, chat time-to-first-token, thread/route switching, warm-transition
> prefetch, and list pagination. These are not asserted by the e2e suite, so
> they are a manual / assisted pass.

## Scope

Measure with the browser's Performance/Network panel (or the Playwright MCP
network tools). The app emits a dev-only `markColdLoad` trace useful for the
cold-load measurement. Run on a warm provider (or mode A's ~150 ms mock) and
note which mode you used — a local self-hosted backend amplifies per-query
latency several-fold, so record absolute numbers and the environment together.

## Prerequisites

Stack up + signed in per [SETUP.md](SETUP.md). For cold-load, clear the cache
and hard-reload; for warm transitions, navigate normally so the loader prefetch
and module cache are primed.

## Automated coverage

| Case(s)               | Status         | e2e spec                                         |
| --------------------- | -------------- | ------------------------------------------------ |
| P5 (pagination works) | 🔶 partial     | `list-behaviors.spec.ts` (functional, not timed) |
| P1–P4, P6, P7         | ⛔ manual-only | — (no load-timing assertions in e2e)             |

## Checks

| ID  | Metric                  | How                                                                         | Target                                                                           |
| --- | ----------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| P1  | Cold load → first paint | Clear cache, hard-reload `/dashboard/{org}`                                 | Shell paints during the auth handshake; usable < 3 s warm provider               |
| P2  | Chat TTFT               | Send a simple prompt, time to first token                                   | < 3 s warm (live); ~150 ms (mock). Note: real Auto routing is slower locally     |
| P3  | Thread switch           | Open another history thread                                                 | Renders < 1 s                                                                    |
| P4  | Warm transition         | Hover a nav target, then click                                              | Near-instant (row-hover + loader prefetch primes it)                             |
| P5  | List pagination         | Page through a DataTable                                                    | Each page loads < 1 s; no full-page reflow                                       |
| P6  | Settings save           | Save a field, await persistence                                             | Round-trip < 2 s                                                                 |
| P7  | Auth recovery           | Force a transient backend hiccup during boot (e.g. restart Convex mid-load) | The WS recovers and authenticates; no endless skeletons / manual reload required |

## Boundary & error tests

| ID  | Test         | Input                            | Expected                                         |
| --- | ------------ | -------------------------------- | ------------------------------------------------ |
| B1  | Large thread | Open a thread with many messages | Virtualized; scroll stays smooth, memory bounded |
| B2  | Large list   | A list with hundreds of rows     | Paginated/virtualized; first page fast           |
| B3  | Slow network | Throttle to Slow 3G              | Skeletons show (no layout jank); no crash        |

## Accessibility (WCAG 2.1 AA)

| ID  | Check          | Expected                                                                                        |
| --- | -------------- | ----------------------------------------------------------------------------------------------- |
| A1  | Loading state  | Loading containers set `aria-busy`; spinners are `role="status"` (perf work must not drop a11y) |
| A2  | Reduced motion | Transition/prefetch animations respect `prefers-reduced-motion`                                 |

## Issues Found

| #   | Test ID | Route / URL | Mode (mock/live) | Measured | Target | Severity | Notes |
| --- | ------- | ----------- | ---------------- | -------- | ------ | -------- | ----- |
|     |         |             |                  |          |        |          |       |

## Test summary

```
Area: Performance
Checks: ___/7   Environment: mock / live · local / hosted
P1 cold ___ s   P2 TTFT ___ s   P3 switch ___ s
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
