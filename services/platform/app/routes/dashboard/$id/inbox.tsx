import { createFileRoute } from '@tanstack/react-router';

import { lazyComponent } from '@/lib/utils/lazy-component';

const InboxPanel = lazyComponent(() =>
  import('@/app/features/inbox/components/inbox-panel').then((mod) => ({
    default: mod.InboxPanel,
  })),
);

export const Route = createFileRoute('/dashboard/$id/inbox')({
  component: InboxPage,
});

function InboxPage() {
  const { id: organizationId } = Route.useParams();
  return <InboxPanel organizationId={organizationId} />;
}
