---
name: react
description: How to write React 19 + TanStack Router/Query UI in services/platform/app and packages/ui — route-scoped vs shared code, router navigation, the gated Convex data-fetching hooks, loader prefetch, Skeletonize loading, optimistic mutations, i18n, and the no-useEffect-reflex. Read before adding or editing a component/hook/route under services/platform/app/**, fetching Convex data from the client, building a loading state, or wiring a route loader. Primitive styling (Radix/CVA/Tailwind/Storybook) lives in ui-components.
---

# react

The contract for client UI in [`services/platform/app/`](../../../services/platform/app/) and shared
components in [`packages/ui/`](../../../packages/ui/). React 19, TanStack Router + Query, Convex as the
live data source; files are **dash-case**. Primitive styling (Radix, CVA, Tailwind, Storybook, a11y)
lives in [`ui-components`](../ui-components/SKILL.md); the backend queries these hooks call in
[`convex`](../convex/SKILL.md); cold-load auth-gating, prefetch tuning, and memoization in
[`performance`](../performance/SKILL.md). After a change, run the `react-doctor` harness skill.

## When this applies

Adding or editing any component, hook, or route under `services/platform/app/**` or
`packages/ui/src/**`; fetching Convex data from the client; building a loading state; wiring a route
loader; or threading a user-facing string. For how a primitive is _styled_ (CVA vs `cn()`, tokens,
a11y, Storybook), read [`ui-components`](../ui-components/SKILL.md) instead.

## The rules

- **`app/` is route-scoped; promote shared code to top-level.** Code used by one route tree lives in
  `app/features/<x>/` or `app/routes/`; anything reused across routes goes to top-level
  [`components/`](../../../services/platform/app/components/) /
  [`hooks/`](../../../services/platform/app/hooks/) / `lib/`. This keeps the dependency direction
  one-way (shared never imports a feature).
- **Navigate with the router, never `window.location`.** Use `useNavigate()` / `<Link>` from TanStack
  Router for in-app navigation so loaders, prefetch, and the nav progress bar run. `window.location`
  is only for _leaving_ the SPA (SSO/OAuth redirects).
- **Fetch through the gated hooks, not raw Convex.** Use
  [`useConvexQuery`](../../../services/platform/app/hooks/use-convex-query.ts) (defaults
  `requireAuth: true`),
  [`useConvexMutation`](../../../services/platform/app/hooks/use-convex-mutation.ts),
  [`useConvexPaginatedQuery`](../../../services/platform/app/hooks/use-convex-paginated-query.ts), and
  [`useListPage`](../../../services/platform/app/hooks/use-list-page.ts) (unified infinite-scroll /
  pagination + search/filter; real site:
  [`customers-table.tsx`](../../../services/platform/app/features/customers/components/customers-table.tsx)).
  _Why_ the gate exists and when to flip `requireAuth: false` is owned by
  [`performance`](../performance/SKILL.md) — don't restate it here.
- **Never mirror server state in `useState`.** `useConvexMutation`'s `optimisticUpdate` uses Convex's
  native `.withOptimisticUpdate` (auto-rolls-back on settle/error); a local `useState` copy
  double-sources the truth and drifts. Set `errorToast` (or `false` when the caller shows its own
  toast).
- **Loading = `<Skeletonize loading>` masking the real tree, never a parallel mock.** Render the
  component _once_ inside
  [`<Skeletonize loading>`](../../../packages/ui/src/components/feedback/skeleton-context.tsx) (from
  `@tale/ui/skeleton-context`); skeleton-aware leaves mask themselves to their natural size via
  `useSkeleton()`, so the skeleton can't drift from content. No `if (loading) return <Skeleton/>`
  whole-tree swap, no magic `h-[…]`. `SkeletonBox`/`SkeletonText` (from `@tale/ui/skeleton`) are only
  for placeholder rows with no real element to mask.
- **Prefetch render-gating data in the loader to skip the skeleton.** Await
  [`ensureConvexQuery`](../../../services/platform/app/lib/loader-preload.ts) in a route loader for the
  _small, bounded_ query that decides what renders (access/member context, the gating entity), so the
  component reads it warm — see
  [`routes/dashboard/$id.tsx`](../../../services/platform/app/routes/dashboard/$id.tsx). Never await a
  list/unbounded query: blocking the transition is worse than a skeleton. (Prefetch mechanics:
  [`performance`](../performance/SKILL.md).)
- **No hardcoded strings; no bare `<img>`.** Every user-facing string goes through `useT('namespace')`
  ([`@/lib/i18n/client`](../../../services/platform/lib/i18n/client.tsx) in app code;
  [`@tale/ui/i18n/client`](../../../packages/ui/src/i18n/client.tsx) for shared components). Use
  `Image` from [`@tale/ui/image`](../../../packages/ui/src/components/primitives/image.tsx).
- **Resist the `useEffect` reflex.** Prefer derived state in render, event handlers, or the router
  (loaders/search params) over effects that sync state. Reach for `useMemo`/`memo` only when a profile
  justifies it ([`performance`](../performance/SKILL.md)). Reviewer- and `react-doctor`-caught.
- **CVA for named variants, `cn()` for boolean states.** Named axes (`variant`/`size`/`tone`) → CVA; a
  one-off conditional class → `cn()`. Full styling doctrine in
  [`ui-components`](../ui-components/SKILL.md).

## Patterns

**Container / presentational split with `Skeletonize`** — the container owns the queries and derives a
single `loading`, then hands plain data to a presentational view wrapped once
([`organization-settings.tsx`](../../../services/platform/app/features/settings/organization/components/organization-settings.tsx)):

```tsx
import { Skeletonize } from '@tale/ui/skeleton-context';

function OrganizationSettings() {
  const organization = useConvexQuery(
    api.organizations.queries.getOrganization,
    { organizationId },
  );
  // ...ability + members queries; each exposes its own loading flag
  return (
    <Skeletonize loading={abilityLoading || isOrgLoading || isMembersLoading}>
      <OrganizationSettingsView
        organization={organization ?? null}
        onSave={save} /* …data props */
      />
    </Skeletonize>
  );
}
```

`OrganizationSettingsView` is pure (props in, no fetching); skeleton-aware leaves inside it mask
themselves when `loading` — there is no second skeleton tree to keep in sync.

**Optimistic mutation** — patch every cached variant, let Convex roll back
([`customers/hooks/mutations.ts`](../../../services/platform/app/features/customers/hooks/mutations.ts)):

```tsx
export function useUpdateCustomer() {
  return useConvexMutation(api.customers.mutations.updateCustomer, {
    errorToast: false, // the edit dialog shows its own toast
    optimisticUpdate: (store, args) => {
      // one merge, reused for both cached views; only patch defined fields
      const applyEdits = (c: Doc<'customers'>) => ({
        ...c,
        ...(args.name !== undefined && { name: args.name }),
        ...(args.status !== undefined && { status: args.status }),
      });
      updateItemInListQuery(
        store,
        api.customers.queries.listCustomers,
        args.customerId,
        applyEdits,
      );
      updateItemInPaginatedQuery(
        store,
        api.customers.queries.listCustomersPaginated,
        args.customerId,
        applyEdits,
      );
    },
  });
}
```

Helpers (`updateItemInListQuery` / `insertItemIntoListQuery` / `removeItemFromListQuery`) live in
[`app/hooks/optimistic-updates.ts`](../../../services/platform/app/hooks/optimistic-updates.ts). Don't
re-derive a server filter's predicate client-side — let the settle re-run the query.

## See also

[`ui-components`](../ui-components/SKILL.md) (primitives, CVA, a11y, Storybook) ·
[`convex`](../convex/SKILL.md) (the queries these hooks call) ·
[`performance`](../performance/SKILL.md) (cold-load gating, prefetch, memoization) ·
[`testing`](../testing/SKILL.md) (Testing Library + Playwright).
