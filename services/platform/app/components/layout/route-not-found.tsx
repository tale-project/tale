'use client';

import { useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';

import { DashboardNotFound } from '@/app/components/layout/dashboard-not-found';
import { seo } from '@/lib/utils/seo';

// Route id (and id prefix) of the dashboard org subtree. Every dashboard page
// lives under `/dashboard/$id`, so any matched route whose id starts with this
// threads the `id` (organization) param we need for the recovery link.
const DASHBOARD_ORG_ROUTE_ID = '/dashboard/$id';

// Pull the document `<title>` string out of the SAME `seo('notFound')` meta tags
// the `/dashboard/$id/$` splat sets via its route `head`, so a nested miss shows
// the identical "Page not found" title. `RouteNotFound` is a plain component, not
// a route, so it carries no `head`: the title for a nested miss otherwise comes
// from the deepest matched route's `head`, and several dashboard sub-layouts
// (e.g. `projects/$projectId`, `automations/$automationSlug`) set none — leaving the title to
// fall back to the marketing default (issue #2097). Sourcing it here keeps 404
// titles consistent across every dashboard subtree.
function notFoundTitle(): string | undefined {
  const titleTag = seo('notFound').find(
    (tag): tag is { title: string } => 'title' in tag,
  );
  return titleTag?.title;
}

/**
 * Sets the document title while mounted, restoring the prior title on unmount so
 * we don't permanently overwrite whatever TanStack's `HeadContent` rendered for
 * the matched route. Mirrors the existing tab-title pattern in `online-gate`. An
 * `undefined` title is a no-op, so callers can keep hook order stable without
 * branching on the dashboard check.
 */
function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (title === undefined || typeof document === 'undefined') {
      return undefined;
    }
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

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
 * link. We also set the same "Page not found" document title the splat sets via
 * `head`, so head-less nested layouts no longer leak the marketing-default title.
 * Outside the dashboard there is no such param, so we preserve TanStack's minimal
 * default fallback rather than show a dashboard-flavoured 404.
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

  // Only override the title inside the dashboard subtree; a non-dashboard miss
  // keeps TanStack's default behaviour untouched.
  useDocumentTitle(organizationId !== undefined ? notFoundTitle() : undefined);

  if (organizationId !== undefined) {
    return <DashboardNotFound organizationId={organizationId} />;
  }

  // Mirrors TanStack Router's built-in `DefaultGlobalNotFound`: out-of-scope
  // non-dashboard routes keep their prior behaviour unchanged.
  return <p>Not Found</p>;
}
