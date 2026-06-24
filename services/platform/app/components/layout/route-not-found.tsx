'use client';

import { useRouterState } from '@tanstack/react-router';

import { DashboardNotFound } from '@/app/components/layout/dashboard-not-found';

// Route id (and id prefix) of the dashboard org subtree. Every dashboard page
// lives under `/dashboard/$id`, so any matched route whose id starts with this
// threads the `id` (organization) param we need for the recovery link.
const DASHBOARD_ORG_ROUTE_ID = '/dashboard/$id';

/**
 * Router-level fallback for an unmatched URL (wired as the router's
 * `defaultNotFoundComponent`).
 *
 * TanStack renders a not-found at the DEEPEST matched route's outlet, using that
 * route's own `notFoundComponent` (there is no ancestor inheritance) and only
 * then falling back to this component. The `/dashboard/$id/$` splat catches
 * misses DIRECTLY under `$id` (e.g. `/dashboard/{org}/typo`), but a miss under a
 * nested dashboard layout (e.g. `/dashboard/{org}/settings/typo`) bottoms out at
 * that layout route — which has no splat of its own — so without this it would
 * render the bare unstyled "Not Found" the layout's `<Outlet/>` produces.
 *
 * When the unmatched URL is anywhere inside the dashboard org subtree we read the
 * `id` param threaded through `/dashboard/$id` and render the same styled 404 as
 * the splat, keeping the dashboard shell + side-nav up and offering a recovery
 * link. Outside the dashboard there is no such param, so we preserve TanStack's
 * minimal default fallback rather than show a dashboard-flavoured 404.
 */
export function RouteNotFound() {
  const organizationId = useRouterState({
    select: (state) => {
      const dashboardMatch = state.matches.find((match) =>
        match.routeId.startsWith(DASHBOARD_ORG_ROUTE_ID),
      );
      const params = dashboardMatch?.params;
      if (params && 'id' in params && typeof params.id === 'string') {
        return params.id;
      }
      return undefined;
    },
  });

  if (organizationId !== undefined) {
    return <DashboardNotFound organizationId={organizationId} />;
  }

  // Mirrors TanStack Router's built-in `DefaultGlobalNotFound`: out-of-scope
  // non-dashboard routes keep their prior behaviour unchanged.
  return <p>Not Found</p>;
}
