import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Bare `/automations/$automationSlug` is an alias, not a page: bookmarks,
 * search hits and API-side links land here and forward to the Editor, the
 * automation's default surface — exactly as a bare project URL forwards to
 * Tasks.
 */
export const Route = createFileRoute(
  '/dashboard/$id/automations/$automationSlug/',
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/automations/$automationSlug/editor',
      params,
      replace: true,
    });
  },
});
