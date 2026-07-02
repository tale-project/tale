# Performance — Manual Test Plan (cross-cutting)

> **Purpose**: Spot-check the load and interaction budgets — cold load to first
> paint, chat time-to-first-token (TTFT), thread/route switching, warm-transition
> prefetch, list pagination, and the auth-recovery path. None of these are timed
> by the e2e suite, so this is a manual / AI-assisted pass.

## Scope & routes

| Surface             | Route                              |
| ------------------- | ---------------------------------- |
| Org root (→ chat)   | `/dashboard/{org}`                 |
| Chat composer       | `/dashboard/{org}/chat`            |
| Chat thread         | `/dashboard/{org}/chat/{threadId}` |
| Conversations list  | `/dashboard/{org}/conversations`   |
| Customers DataTable | `/dashboard/{org}/customers`       |
| Settings            | `/dashboard/{org}/settings`        |

`/dashboard/{org}` redirects to `/dashboard/{org}/chat`; `/settings` redirects to
`/settings/account`; `/conversations` redirects to `/conversations/open`. `{org}`
is the 16+ char id in the dashboard URL.

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md). Decide and **record two
axes** for every number, because both move it by an order of magnitude:

- **Mode** — `mockA` (the `lib/mocks` gateway on :4141, deterministic) or `live`
  (a real provider configured in Settings → Providers).
- **Backend** — `local` (self-hosted Convex at `:3210`, what dev/SETUP.md gives
  you) or `hosted` (a cloud Convex deployment).

> **Agent / measurement note**:
>
> - The app emits a **dev-only cold-load trace** to the browser console:
>   `[cold-load] <label>: <ms>` for `module-load`, `convex-authenticated`,
>   `member-context`, `account-bootstrap` (source:
>   `app/lib/perf/cold-load-trace.ts`). One hard refresh prints all four; the
>   deltas localise the cost (bundle vs. auth handshake vs. gate queries). In a
>   **production** build enable it with `localStorage.tale_perf = '1'` then
>   hard-refresh.
> - **The dev server is NOT a perf target.** Under `bun scripts/dev.ts` the
>   first hit on a cold route triggers a Vite transform, so `module-load` alone
>   is multiple seconds (measured 5.5–9.6 s here) and is pure dev tooling, not
>   the product. Treat dev numbers as **relative** (compare deltas / warm-vs-cold)
>   and reserve absolute pass/fail to a **production build** (`bun run build` +
>   serve) — note which you used.
> - A chat turn reaches a terminal state when the composer toggles **Stop
>   generating** (`chat.stopGenerating`) back to **Send message** (`chat.send`).
>   Time/await on that toggle, never on streamed text. "TTFT ≈ 150 ms" describes
>   only the mock gateway's SSE first byte — the **observed turn round-trip** in
>   `mockA` + `local` is far longer (~14 s here) because the Auto classifier hop
>   plus the local self-hosted backend amplify per-query latency ~5–10×.

## Automated coverage

| Case(s)             | Status         | e2e spec                                                                       |
| ------------------- | -------------- | ------------------------------------------------------------------------------ |
| P5 (pagination)     | 🔶 partial     | `conversations.spec.ts`, `projects-depth.spec.ts` (functional, NOT timed)      |
| P2 (chat turn ends) | 🔶 partial     | `chat-threads.spec.ts`, `chat-depth.spec.ts` (asserts terminal state, untimed) |
| P3 (thread switch)  | 🔶 partial     | `chat-threads.spec.ts` (switches threads functionally, untimed)                |
| P1, P4, P6, P7      | ⛔ manual-only | — (no load-timing assertions exist in e2e)                                     |
| B4 (provider error) | 🔶 partial     | `chat-scenarios.spec.ts` (error path functional, NOT timed)                    |
| B1–B3, A1, A2       | ⛔ manual-only | — (load characteristics / DOM attributes, not asserted)                        |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

> No `list-behaviors.spec.ts` exists — the suite has 29 specs and pagination
> behaviour lives in `conversations.spec.ts` / `projects-depth.spec.ts`. None
> assert timing; they only prove the functional path, so every P-row below stays
> a manual measurement.

## Functional / performance tests

| ID  | Metric                  | Steps (route + control)                                                                                                   | Expected (verifiable)                                                                                                                                                                                                                                                           |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Cold load → first paint | Clear cache, hard-reload `/dashboard/{org}`. Watch the console for `[cold-load]` lines.                                   | All four `[cold-load]` labels print (`module-load`, `convex-authenticated`, `member-context`, `account-bootstrap`); the **Send message** button (`chat.send`) becomes visible. Prod build: usable < 3 s (`mockA`/`live`, `hosted`). Dev/local: record absolute + note it's dev. |
| P2  | Chat TTFT / turn        | On `/dashboard/{org}/chat` type `hello`, click **Send message** (`chat.send`).                                            | **Stop generating** (`chat.stopGenerating`) appears, then disappears (turn done) and the URL gains `/chat/{threadId}`. Target: prod `live`/`hosted` < 3 s to first token; `mockA`/`local` ≈ 12–18 s round-trip (classifier + local amp) — record the number, do not fail it.    |
| P3  | Thread switch           | On `/dashboard/{org}/chat/{threadId}` open a different thread (chat sidebar) or a row in `/conversations`.                | URL `{threadId}` changes and the message list repaints. Target: warm prod < 1 s; record the dev/local number.                                                                                                                                                                   |
| P4  | Warm transition         | Hover a left-nav target (e.g. **Customers**), then click it.                                                              | URL commits to `/dashboard/{org}/customers`; on a warm module cache the route paints without a blocking skeleton (row-hover + loader prefetch primed it). Compare cold vs. warm nav delta.                                                                                      |
| P5  | List pagination         | On `/dashboard/{org}/conversations` (or `/customers`) page through the DataTable when more than one page exists.          | Each page swap loads the next rows; the page chrome/header does NOT reflow or scroll-jump. Target: next page < 1 s warm.                                                                                                                                                        |
| P6  | Settings save           | On `/dashboard/{org}/settings/account` edit a field; the global save bar appears; click **Save** (`common.actions.save`). | The bar shows a saved state; **reload the page and read the field back** — the new value persists (assert by reload, not the toast). Target: round-trip < 2 s warm.                                                                                                             |
| P7  | Auth recovery           | During a cold load, induce a transient backend hiccup (restart Convex `:3210` mid-handshake).                             | The WS reconnects and authenticates: the shell finishes painting and chat becomes usable WITHOUT a manual reload (no endless skeletons). See `cold-start-auth-recovery`. Mark **ENVIRONMENT** if you cannot induce the hiccup.                                                  |

## Boundary & error tests

| ID  | Test                | Input                                                                 | Expected (verifiable)                                                                                                                                                                     |
| --- | ------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Large thread        | Open a chat thread with many messages.                                | Scroll stays responsive; no `pageerror`/console error; DOM node count does not grow unbounded (older messages are recycled).                                                              |
| B2  | Large list          | A DataTable with hundreds of rows (`/customers` or `/conversations`). | First page renders quickly and is paginated (only one page of rows in the DOM); paging does not load the whole set at once.                                                               |
| B3  | Slow network        | DevTools throttle to **Slow 3G**, hard-reload `/dashboard/{org}`.     | Loading skeletons (`aria-busy="true"` regions) show during load with NO layout jank; the page eventually renders; no crash.                                                               |
| B4  | Chat provider error | Send a message containing `e2e:error` in `mockA`.                     | The provider-error UI renders (HTTP 500 path); the composer recovers to **Send message** enabled — no spinner stuck on, no page crash. This is the designed error path (**ENVIRONMENT**). |

## Accessibility (WCAG 2.1 AA)

| ID  | Check          | Expected (verifiable)                                                                                                                                                                                                                                                                        |
| --- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Loading state  | While a region loads, a `<Skeletonize>` wrapper exposes `role="status"` + `aria-busy="true"` + an `aria-label` (source: `packages/ui/.../skeleton-context.tsx`); `loading-overlay` exposes `role="status"` + `aria-live="polite"`. Verify the attributes are present in the DOM during load. |
| A2  | Reduced motion | With `prefers-reduced-motion: reduce`, skeleton shimmer stops: the pulse element carries `motion-reduce:animate-none` (source: `packages/ui/.../skeleton.tsx`) so no infinite animation runs. Verify via emulated reduced-motion.                                                            |

## Issues Found

| #   | Test ID | Route / URL | Mode (mockA/live) · Backend (local/hosted) | Measured | Target | Severity | Notes |
| --- | ------- | ----------- | ------------------------------------------ | -------- | ------ | -------- | ----- |
|     |         |             |                                            |          |        |          |       |

## Test summary

```
Area: Performance
Cases: ___/7   Mode: mockA / live   Backend: local / hosted   Build: dev / prod
P1 cold (Δ module-load / convex-authenticated / gates) ___ / ___ / ___ ms
P2 chat turn ___ s   P3 thread switch ___ s   P6 settings save ___ s
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
