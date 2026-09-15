'use client';

import { Stack } from '@tale/ui/layout';
import { rootRouteId, useMatch, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';

import { DashboardNotFound } from '@/app/components/layout/dashboard-not-found';
import { NotFoundState } from '@/app/components/layout/not-found-state';
import { LogoLink } from '@/app/components/logo/logo-link';
import { seo } from '@/lib/utils/seo';

// Route id (and id prefix) of the dashboard org subtree. Every dashboard page
// lives under `/dashboard/$id`, so any matched route whose id starts with this
// threads the `id` (organization) param we need for the recovery link.
const DASHBOARD_ORG_ROUTE_ID = '/dashboard/$id';

// Pull the document `<title>` string out of the SAME `seo('notFound')` meta tags
// the `/dashboard/$id/$` splat sets via its route `head`, so every miss shows the
// identical "Page not found" title. `RouteNotFound` is a plain component, not a
// route, so it carries no `head`: the title otherwise comes from the deepest
// matched route's `head` — the root's marketing default outside the dashboard,
// and that same default under the dashboard sub-layouts that set none (e.g.
// `projects/$projectId`, `automations/$automationSlug`).
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
 * `undefined` title is a no-op.
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
 * that layout route — which has no splat of its own. Outside the dashboard a miss
 * bottoms out at the root (e.g. `/login`), or at the sign-in layout for a path
 * beneath one of its pages (e.g. `/log-in/typo`).
 *
 * When the unmatched URL is anywhere inside the dashboard org subtree we read the
 * `id` param threaded through `/dashboard/$id` and render the same 404 as the
 * splat, keeping the dashboard shell + side-nav up and offering a recovery link
 * to the org dashboard. Outside the dashboard there is no org to name, so the
 * recovery link goes to `/dashboard`; at the root nothing frames the page yet, so
 * the not-found state stands as a page of its own (see `StandaloneNotFound`),
 * while under a layout it takes that layout's frame. Either way we set the "Page
 * not found" document title the splat sets via `head`.
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
  // The nearest match is the route whose outlet renders this miss.
  const framedByLayout = useMatch({
    strict: false,
    select: (match) => match.routeId !== rootRouteId,
  });

  useDocumentTitle(notFoundTitle());

  if (organizationId !== undefined) {
    return <DashboardNotFound organizationId={organizationId} />;
  }

  if (framedByLayout) {
    return <NotFoundState href="/dashboard" />;
  }

  return <StandaloneNotFound />;
}

/**
 * A miss at the root, in the frame the sign-in pages use: the logo home link in
 * the top corner over the `main` landmark the skip link targets. The recovery
 * link goes to `/dashboard`, which resumes the last organization — or asks a
 * signed-out visitor to log in first and continues there.
 */
function StandaloneNotFound() {
  return (
    <Stack gap={0} className="bg-background text-foreground min-h-dvh">
      <header className="pt-[calc(2rem+var(--safe-top))] pr-[calc(1rem+var(--safe-right))] pl-[calc(1rem+var(--safe-left))] sm:pr-[calc(2rem+var(--safe-right))] sm:pl-[calc(2rem+var(--safe-left))]">
        <LogoLink href="/" />
      </header>
      {/* outline-none: skip-link target focused only programmatically — the
          browser's focus ring would outline the whole page body. The bottom
          padding matches the logo row, so the state sits at the viewport's
          centre rather than below it. */}
      <Stack
        as="main"
        id="main-content"
        tabIndex={-1}
        gap={0}
        className="flex-1 pb-[calc(3.5rem+var(--safe-bottom))] outline-none"
      >
        <NotFoundState href="/dashboard" />
      </Stack>
    </Stack>
  );
}
