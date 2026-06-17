---
name: performance
description: How Tale keeps the platform fast — frontend cold-load auth-gating, per-query Convex auth cost, route-loader prefetch, and chat TTFT / prompt-cache hygiene. Read before debugging slow cold loads, slow page transitions, expensive Convex queries, or chat TTFT; or when adding a query/loader. Backend mechanics live in convex; component re-renders in react.
---

# performance

How the platform stays fast across three hot paths: **cold load** (first paint + WebSocket auth),
**per-query backend cost**, and **chat TTFT**. Backend function rules (RLS, no `.collect()`) live in
[`convex`](../../../.claude/skills/convex/SKILL.md); component-level re-render work lives in
[`react`](../../../.claude/skills/react/SKILL.md). This skill is about the _seams between_ them.

## Rule 0 — measure before you optimize

Profile first; never optimize on a hunch. A "slow query" is usually auth round-trips, not the data
read; a "slow page" is usually an un-prefetched loader, not React. The local self-hosted backend
amplifies cross-component auth latency **~5–10×**, so a number that looks alarming locally may be
fine in prod — confirm the path before you touch it. For chat, the `PERF_SUMMARY` debug log
(`generate_response.ts`, gated by `DEBUG_MODE=true` — see
[`lib/debug_log.ts`](../../../services/platform/convex/lib/debug_log.ts)) prints the
routing/startChat/generation breakdown; read it before guessing where TTFT goes. Confirm a change
with a before/after — see [`verify`](../verify/SKILL.md).

## When this applies

- A cold load shows endless skeletons or `UnauthorizedError`, or a page transition flashes a
  skeleton it shouldn't.
- A Convex query is slow, or you're **adding** a query/loader/mutation under
  `services/platform/app/**` or `services/platform/convex/**`.
- Chat time-to-first-token regresses, or you're editing the system-prompt / personalization prefix
  in [`convex/lib/agent_response/`](../../../services/platform/convex/lib/agent_response/).

## The rules

- **Gate authenticated queries on auth — via `requireAuth`, not `'skip'`.** On cold load, queries can
  fire before the Convex WebSocket finishes authenticating →
  [`UnauthorizedError`](../../../services/platform/app/hooks/use-convex-query.ts). `useConvexQuery`
  defaults `requireAuth: true` and **folds the gate into the effective `enabled`** (not a separate
  `'skip'`), because a manual `'skip'` loses to a later `enabled` resolving true. Set
  `requireAuth: false` _only_ for the auth probe and genuinely public reads — leaving a pre-auth
  query gated hangs it forever.
- **Guard blank ids before they hit the backend.** An empty/whitespace id passed into a Convex query
  becomes a wasted (or erroring) round-trip — short-circuit `''`/falsy ids on the client (or with
  `'skip'`) before the query subscribes. Reviewer-caught.
- **Read queries use `getAuthUserIdentity`, never `authComponent.getAuthUser`.**
  [`getAuthUserIdentity`](../../../services/platform/convex/lib/rls/auth/get_auth_user_identity.ts)
  reads the already-validated JWT (**0 DB reads**); `getAuthUser` costs **2 cross-component DB
  reads** (session + user). Cross-component Better Auth calls dominate backend latency. This is also
  a [`convex`](../../../.claude/skills/convex/SKILL.md) rule.
- **Don't recompute the auth triple per handler.** The RLS wrappers memoize `{user, orgs, teams}`
  per request via
  [`getRequestAuthContext`](../../../services/platform/convex/lib/rls/context/request_auth_cache.ts)
  (a `WeakMap` keyed on the per-request `ctx.auth`). A helper that re-derives org/team membership
  pays the round-trips twice — reuse the context instead.
- **Never `.collect()` in Convex.** It loads the whole result set into memory. `for await` or
  `.paginate()` — see [`convex`](../../../.claude/skills/convex/SKILL.md).
- **Warm render-gating data in the route loader with `ensureConvexQuery`** (there is **no**
  `preloadConvexQuery`). [`ensureConvexQuery`](../../../services/platform/app/lib/loader-preload.ts)
  awaits the first WS result, warms the React Query cache (component paints real content, no
  skeleton flash), and leaves the live subscription in place. Use it **only** for _bounded_ data
  that decides what renders — never a list/unbounded query (blocking the transition is worse than a
  skeleton). Always `.catch` at the call site so a transient/auth error can't fail the transition.
- **Keep the chat cacheable prefix byte-stable.** Anything volatile in the system/personalization
  prefix (most notoriously a per-turn `Current Time`) busts the provider's prompt cache and tanks
  the cache-hit ratio. Time and other per-turn data go in the **volatile tail**, not the prefix —
  see [`build_system_prompt.ts`](../../../services/platform/convex/lib/agent_response/build_system_prompt.ts)
  and the `includeCurrentTime` flag in
  [`resolve_template_variables.ts`](../../../services/platform/convex/lib/agent_response/resolve_template_variables.ts).
  Enforced by `build_system_prompt.test.ts`'s cache-breakpoint contract.
- **Memoize only when a profile justifies it.** `useMemo`/`React.memo` add code and a deps-array
  footgun; reach for them when measurement shows a real re-render cost, not reflexively. See
  [`react`](../../../.claude/skills/react/SKILL.md).

## Patterns

Auth-gate folded into `enabled` (the working shape — do not reintroduce a `useState` mirror or a
manual `'skip'` race):

```ts
// useConvexQuery internals — gate composes with caller enabled, never replaces it
const enabled =
  (requireAuth ? isAuthenticated : true) && (base.enabled ?? true);
```

Prefetch a render-gating entity in a loader so the page paints warm:

```ts
export const loader = async ({ context, params }) => {
  // bounded, decides render vs empty/denied — safe to await; covered by RouteProgressBar
  await ensureConvexQuery(context, api.threads.getThread, {
    id: params.id,
  }).catch(() => {});
};
```

Paginated lists are different. `useCachedPaginatedQuery` /
[`primeCachedPaginatedQuery`](../../../services/platform/app/hooks/use-cached-paginated-query.ts)
exist because Convex `usePaginatedQuery` mints a per-mount `paginationOpts.id` — a plain
`convexQuery` loader prefetch **misses the subscription**. To warm a list from a loader, use
`primeCachedPaginatedQuery` with args that exactly equal the hook's `queryArgs`, and `void` it
(fire-and-forget, client-only).

Global `staleTime` is `5 * 60 * 1000` in
[`router.tsx`](../../../services/platform/app/router.tsx) (and the session query), so warmed data
isn't refetched on every nav while the live subscription still pushes updates.

## Companion files

None — depth lives in the linked source files and sibling skills
([`convex`](../../../.claude/skills/convex/SKILL.md),
[`react`](../../../.claude/skills/react/SKILL.md),
[`convex-migrations`](../../../.claude/skills/convex-migrations/SKILL.md)). Verify any change against
a running stack with [`verify`](../verify/SKILL.md).
