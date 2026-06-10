import { createFileRoute } from '@tanstack/react-router';

import { lazyComponent } from '@/lib/utils/lazy-component';

const InboxPanel = lazyComponent(() =>
  import('@/app/features/inbox/components/inbox-panel').then((mod) => ({
    default: mod.InboxPanel,
  })),
);

export const Route = createFileRoute('/dashboard/$id/inbox')({
  // Warm the InboxPanel chunk during the loader so it's cached by the time the
  // component renders — removes the Suspense fallback flash on first nav.
  // Fire-and-forget; the lazy boundary still covers a cold cache.
  loader: () => {
    void import('@/app/features/inbox/components/inbox-panel');
  },
  component: InboxPage,
});

function InboxPage() {
  const { id: organizationId } = Route.useParams();
  return <InboxPanel organizationId={organizationId} />;
}
