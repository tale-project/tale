import { createFileRoute, redirect } from '@tanstack/react-router';

import {
  automationSlugToParam,
  paramToAutomationSlug,
} from '@/app/features/automations/lib/slug';

/**
 * Redirect for a bookmark to the standalone workflow editor.
 *
 * A workflow is no longer addressed on its own: it is the document of an
 * automation, and its slug IS the automation's name — so the whole
 * `/workflows/$workflowId` family (editor plus its executions, configuration,
 * and triggers children) is now the automation detail page. A saved link lands
 * on that automation, or on its not-found panel.
 *
 * Foldered workflow ids already encoded `/` as `__` in the URL (for example
 * `projects__tasks__run-assigned-task`) — the same encoding an automation slug
 * travels under now — so an old id decodes straight into a candidate name. One
 * whose leaf was also renamed lands on the not-found panel, which is the honest
 * answer for a link to a workflow that no longer exists.
 */
export const Route = createFileRoute('/dashboard/$id/workflows/$workflowId')({
  loader: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/automations/$automationSlug',
      params: {
        id: params.id,
        // Round-tripped through the shared codec so either form of an old
        // bookmark lands correctly: the `__` the workflow ids already used,
        // and a hand-written one carrying a literal `/`.
        automationSlug: automationSlugToParam(
          paramToAutomationSlug(params.workflowId),
        ),
      },
    });
  },
});
