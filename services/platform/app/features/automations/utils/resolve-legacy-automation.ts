import { convexQuery } from '@convex-dev/react-query';

import { workflowListKey } from '@/app/features/workflows/hooks/file-queries';
import type { RouterContext } from '@/app/router';
import { api } from '@/convex/_generated/api';

import type { AutomationSummary } from '../hooks/use-automations';

/**
 * Whether `automationSlug` resolves to an installed or catalog automation for this
 * org — gates the legacy-bookmark fallback on the automation detail route
 * (D3): a pre-rename `/automations/{workflowSlug}` link only redirects to the
 * standalone workflow route when the slug ISN'T a real automation today (a
 * real automation always wins).
 *
 * Warms the exact TanStack Query cache entries `useAutomations` /
 * `useAutomationCatalog` read (same query key + fetcher), so the page's own
 * hooks resolve from cache on mount instead of refetching. A fetch failure
 * (including a cold-load run before the WebSocket auth handshake resolves —
 * `agents/$agentId.tsx`'s loader documents the same race) defaults to `true`
 * (assume it's real) so neither a transient error nor an unauthenticated
 * cold load ever misroutes an existing automation away to the workflow
 * fallback.
 */
export async function resolvesToAutomation(
  context: RouterContext,
  organizationId: string,
  automationSlug: string,
): Promise<boolean> {
  const isAuthenticated = !!context.queryClient.getQueryData(
    convexQuery(api.users.queries.getCurrentUser, {}).queryKey,
  );
  if (!isAuthenticated) return true;
  try {
    const [installed, catalog] = await Promise.all([
      context.queryClient.fetchQuery({
        queryKey: ['automations', 'list', organizationId],
        queryFn: () =>
          context.convexQueryClient.convexClient.action(
            api.automations.file_actions.listAutomations,
            { organizationId },
          ),
        staleTime: Infinity,
      }),
      context.queryClient.fetchQuery({
        queryKey: ['automations', 'catalog', organizationId],
        queryFn: () =>
          context.convexQueryClient.convexClient.action(
            api.automations.file_actions.listCatalogAutomations,
            { organizationId },
          ),
        staleTime: Infinity,
      }),
    ]);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listAutomations/listCatalogAutomations return v.any(); this only reads `.slug`
    const installedAutomations = installed as AutomationSummary[];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
    const catalogAutomations = catalog as AutomationSummary[];
    return (
      installedAutomations.some((a) => a.slug === automationSlug) ||
      catalogAutomations.some((a) => a.slug === automationSlug)
    );
  } catch (err) {
    console.error('Failed to resolve automation slug for legacy redirect', err);
    return true;
  }
}

/** Whether `slug` names an existing workflow file for this org. */
export function workflowSlugMatches(
  workflows: readonly unknown[] | undefined,
  slug: string,
): boolean {
  return (workflows ?? []).some(
    (w) =>
      w !== null &&
      typeof w === 'object' &&
      'slug' in w &&
      (w as { slug: unknown }).slug === slug,
  );
}

/**
 * Whether `slug` names an existing workflow — the second gate of the D3
 * legacy-bookmark fallback: an unresolved automation slug only redirects to
 * the standalone workflow route when that workflow actually EXISTS (a
 * pre-rename workflow bookmark); a slug that is neither renders the
 * automation not-found surface instead of a workflow one. Errors (and the
 * unauthenticated cold load) resolve `false` — never redirect on uncertainty.
 *
 * Warms the same cache entry `useListWorkflows(organizationId, 'all')` reads.
 */
export async function resolvesToWorkflow(
  context: RouterContext,
  organizationId: string,
  slug: string,
): Promise<boolean> {
  const isAuthenticated = !!context.queryClient.getQueryData(
    convexQuery(api.users.queries.getCurrentUser, {}).queryKey,
  );
  if (!isAuthenticated) return false;
  try {
    const workflows = await context.queryClient.fetchQuery({
      queryKey: workflowListKey(organizationId, 'all'),
      queryFn: () =>
        context.convexQueryClient.convexClient.action(
          api.workflows.file_actions.listWorkflows,
          { organizationId, filter: 'all' },
        ),
      staleTime: Infinity,
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listWorkflows returns v.any(); this only reads `.slug`
    return workflowSlugMatches(workflows as unknown[], slug);
  } catch (err) {
    console.error('Failed to resolve workflow slug for legacy redirect', err);
    return false;
  }
}
