import { createFileRoute } from '@tanstack/react-router';

import { OperatorShell } from '@/app/features/operator/components/operator-shell';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$amId/operator/$executionId',
)({
  head: () => ({
    meta: seo('automationExecutions'),
  }),
  component: OperatorPage,
});

function OperatorPage() {
  const { id: organizationId, executionId } = Route.useParams();
  return (
    <OperatorShell organizationId={organizationId} executionId={executionId} />
  );
}
