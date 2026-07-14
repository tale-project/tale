import { createFileRoute, redirect } from '@tanstack/react-router';

import { paramToAutomationSlug } from '@/lib/shared/schemas/automations';

/**
 * Legacy-bookmark shim. Standalone workflows are gone — a workflow lives only
 * inline in its owning automation's manifest and its slug IS the automation
 * slug — so the whole `/workflows/$workflowId` family (editor + executions/
 * configuration/triggers children) collapsed into the automation detail page's
 * tabs. Old bookmarks land on the automation (or its not-found panel).
 *
 * Old foldered workflow slugs encoded `/` as `__` in the URL (e.g.
 * `projects__tasks__run-assigned-task`) — the SAME encoding an automation slug
 * (itself a path) travels under now, so the old id decodes straight into a
 * candidate automation slug. A builtin whose leaf was also renamed in the
 * cutover (`…/run-assigned-task` → `…/run-assigned`) lands on the not-found
 * panel, which is the honest answer for a bookmark to a retired workflow.
 */
export const Route = createFileRoute('/dashboard/$id/workflows/$workflowId')({
  loader: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/automations/$automationSlug',
      params: {
        id: params.id,
        automationSlug: paramToAutomationSlug(params.workflowId),
      },
    });
  },
});
