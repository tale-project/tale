import { createFileRoute, redirect } from '@tanstack/react-router';

/** Retained history links open the version picker beside the editor tabs. */
export const Route = createFileRoute(
  '/dashboard/$id/automations/$automationSlug/versions',
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/automations/$automationSlug/editor',
      params,
      search: { history: true },
      replace: true,
    });
  },
});
