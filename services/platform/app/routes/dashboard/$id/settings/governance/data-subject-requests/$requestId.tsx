import { createFileRoute, useNavigate } from '@tanstack/react-router';

import type { Id } from '@/convex/_generated/dataModel';
import { lazyComponent } from '@/lib/utils/lazy-component';

const RequestDetailDrawer = lazyComponent(() =>
  import('@/app/features/settings/governance/data-subject-requests/request-detail-drawer').then(
    (m) => ({ default: m.RequestDetailDrawer }),
  ),
);

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/data-subject-requests/$requestId',
)({
  component: RequestDetailRoute,
});

function RequestDetailRoute() {
  const { id: organizationId, requestId } = Route.useParams();
  const navigate = useNavigate();

  const handleClose = () => {
    void navigate({
      to: '/dashboard/$id/settings/governance/data-subject-requests',
      params: { id: organizationId },
    });
  };

  return (
    <RequestDetailDrawer
      organizationId={organizationId}
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- TanStack file-route params are always strings; the runtime validates via the Convex query that the row exists in this org.
      requestId={requestId as Id<'gdprErasureRequests'>}
      open
      onClose={handleClose}
    />
  );
}
