import { createFileRoute } from '@tanstack/react-router';

import { TriggersClient } from '@/app/features/automations/triggers/triggers-client';
import { toId } from '@/convex/lib/type_cast_helpers';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$amId/triggers',
)({
  head: () => ({
    meta: seo({
      title: 'Triggers - Tale',
      description: 'Manage automation triggers, schedules, and webhooks.',
    }),
  }),
  component: TriggersPage,
});

function TriggersPage() {
  const { id: organizationId, amId } = Route.useParams();
  const automationId = toId<'wfDefinitions'>(amId);

  return (
    <TriggersClient
      automationId={automationId}
      organizationId={organizationId}
    />
  );
}
