import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Bare project-scoped `/automations/$automationSlug` is an alias, not a page:
 * it forwards to the Editor, the automation's default surface, exactly like
 * its org-level twin.
 */
export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/$automationSlug/',
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/projects/$projectId/automations/$automationSlug/editor',
      params,
      replace: true,
    });
  },
});
