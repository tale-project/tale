import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { lazyComponent } from '@/lib/utils/lazy-component';

const RequestDetailDrawer = lazyComponent(() =>
  import('@/app/features/settings/governance/data-subject-requests/request-detail-drawer').then(
    (m) => ({ default: m.RequestDetailDrawer }),
  ),
);

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/data-subject-requests/$requestId',
)({
  // Warm the drawer chunk during the loader so it's cached by render time —
  // removes the Suspense fallback flash when opening a request. Fire-and-forget.
  loader: () => {
    void import('@/app/features/settings/governance/data-subject-requests/request-detail-drawer').catch(
      (error: unknown) => {
        console.warn('Failed to preload request detail drawer chunk', error);
      },
    );
  },
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
      requestId={requestId}
      open
      onClose={handleClose}
    />
  );
}
