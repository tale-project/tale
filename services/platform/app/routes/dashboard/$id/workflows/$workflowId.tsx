import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Legacy-bookmark shim. Standalone workflows are gone — a workflow lives only
 * inline in its owning automation's manifest and its slug IS the automation
 * slug — so the whole `/workflows/$workflowId` family (editor + executions/
 * configuration/triggers children) collapsed into the automation detail page's
 * tabs. Old bookmarks land on the automation (or its not-found panel).
 *
 * Old foldered slugs encoded `/` as `__` in the URL (e.g.
 * `projects__tasks__run-assigned-task`); the converted automations kept the
 * basename as their slug, so redirect to the last `__` segment.
 */
export const Route = createFileRoute('/dashboard/$id/workflows/$workflowId')({
  loader: ({ params }) => {
    const segments = params.workflowId.split('__');
    const automationSlug = segments[segments.length - 1] || params.workflowId;
    throw redirect({
      to: '/dashboard/$id/automations/$automationSlug',
      params: { id: params.id, automationSlug },
    });
  },
});
