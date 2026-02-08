import { createFileRoute } from '@tanstack/react-router';
import type { Id } from '@/convex/_generated/dataModel';
import { TriggersClient } from '@/app/features/automations/triggers/triggers-client';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$amId/triggers',
)({
  component: TriggersPage,
});

function TriggersPage() {
  const { id: organizationId, amId } = Route.useParams();
  const automationId = amId as Id<'wfDefinitions'>;

  return (
    <TriggersClient
      automationId={automationId}
      organizationId={organizationId}
    />
  );
}
