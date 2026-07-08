import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

import { AutomationPage } from '@/app/features/automations/components/automation-page';
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
  // standalone workflow route, restoring the pre-rename behavior.
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
  return (
    <AutomationPage
      organizationId={organizationId}
      automationSlug={automationSlug}
    />
  );
}
