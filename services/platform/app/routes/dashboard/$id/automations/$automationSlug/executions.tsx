import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Legacy route. Before the Workflows rename, `/automations/{slug}/executions`
 * was a workflow detail tab; the automation detail pages that own this
 * URL space now have no `executions` child, so the segment is unambiguously an
 * old workflow bookmark — redirect it to the moved
 * `/workflows/$workflowId/executions` tab.
 */
export const Route = createFileRoute(
  '/dashboard/$id/automations/$automationSlug/executions',
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/workflows/$workflowId/executions',
      params: { id: params.id, workflowId: params.automationSlug },
      search: true,
      replace: true,
    });
  },
});
