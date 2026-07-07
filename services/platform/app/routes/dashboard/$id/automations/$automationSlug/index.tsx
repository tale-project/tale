import { SkeletonText } from '@tale/ui/skeleton';
import { createFileRoute, Navigate, redirect } from '@tanstack/react-router';
import { useConvexAuth } from 'convex/react';
import { z } from 'zod';

import { AutomationPage } from '@/app/features/automations/components/automation-page';
import {
  useAutomationCatalog,
  useAutomations,
} from '@/app/features/automations/hooks/use-automations';
import { resolvesToAutomation } from '@/app/features/automations/utils/resolve-legacy-automation';

// `tab` selects the installed automation's Editor/Executions/Configuration/
// Triggers tab (or a builtin/JSON view); deep-linkable, read via the page's
// `useUrlState`. `panel`/`step`/`execution` are the Editor tab's own workflow
// canvas state (step config / test panel / viewed run) — same keys the
// standalone `/workflows/$workflowId` route uses, so the reused canvas
// components read them the same way regardless of which route hosts them.
// `view` optionally forces the Editor tab's Graph/Specification toggle for
// this one visit; the cookie (not this param) is the cross-workflow default
// (`useWorkflowEditorView`).
// `query`/`status`/`triggeredBy`/`dateFrom`/`dateTo` back the Executions tab's
// filter UI (`ExecutionsTable`), mirroring `/workflows/$workflowId/executions`.
const searchSchema = z.object({
  tab: z.string().optional(),
  panel: z.string().optional(),
  step: z.string().optional(),
  execution: z.string().optional(),
  view: z.string().optional(),
  query: z.string().optional(),
  status: z.string().optional(),
  triggeredBy: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const Route = createFileRoute(
  '/dashboard/$id/automations/$automationSlug/',
)({
  validateSearch: searchSchema,
  // D3: a pre-rename `/automations/{workflowSlug}` bookmark predates the
  // Automations rename, back when this URL space belonged to a workflow
  // directly. `$automationSlug` wins whenever it resolves to a real automation
  // (installed or catalog) today; only an UNRESOLVED slug falls back to the
  // standalone workflow route, restoring the pre-rename behavior. This
  // beforeLoad is the fast path (warm cache, no paint); on a COLD load the
  // WebSocket auth handshake hasn't resolved yet, so it fails open ("assume
  // real") and the component below re-runs the decision once the queries
  // actually settle.
  beforeLoad: async ({ context, params }) => {
    const isReal = await resolvesToAutomation(
      context,
      params.id,
      params.automationSlug,
    );
    if (!isReal) {
      throw redirect({
        to: '/dashboard/$id/workflows/$workflowId',
        params: { id: params.id, workflowId: params.automationSlug },
        replace: true,
      });
    }
  },
  component: AutomationIndexRoute,
});

function AutomationIndexRoute() {
  const { id: organizationId, automationSlug } = Route.useParams();
  const { isAuthenticated } = useConvexAuth();
  const { automations, isLoading, error } = useAutomations(organizationId);
  const {
    automations: catalog,
    isLoading: catalogLoading,
    error: catalogError,
  } = useAutomationCatalog(organizationId);

  const resolved =
    automations.some((a) => a.slug === automationSlug) ||
    catalog.some((a) => a.slug === automationSlug);
  if (!resolved) {
    // The queries are `enabled`-gated on auth, so pre-handshake they sit idle
    // with `isLoading: false` and empty data — treat that as still loading,
    // never as "not found" (D3 in `beforeLoad` above).
    if (!isAuthenticated || isLoading || catalogLoading) {
      return <SkeletonText lines={6} />;
    }
    // Settled and genuinely unresolved: the D3 legacy-workflow fallback the
    // fail-open `beforeLoad` skipped on this cold load. A query ERROR renders
    // the page's own not-found/error surface instead — never misroute on a
    // transient failure.
    if (!error && !catalogError) {
      return (
        <Navigate
          to="/dashboard/$id/workflows/$workflowId"
          params={{ id: organizationId, workflowId: automationSlug }}
          replace
        />
      );
    }
  }
  return (
    <AutomationPage
      organizationId={organizationId}
      automationSlug={automationSlug}
    />
  );
}
