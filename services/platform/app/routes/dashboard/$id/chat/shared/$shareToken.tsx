import { createFileRoute } from '@tanstack/react-router';
import { Suspense } from 'react';

import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { PageLayout } from '@/app/components/layout/page-layout';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { SharedChatView } from '@/app/features/chat/components/shared-chat-view';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/chat/shared/$shareToken')({
  head: () => ({
    meta: seo('shared-chat'),
  }),
  component: SharedChatLayout,
});

function SharedChatSkeleton() {
  return (
    <div className="flex h-full flex-col items-center p-8">
      <div className="w-full max-w-(--chat-max-width) space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-3/4" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

function SharedChatLayout() {
  const { id: organizationId, shareToken } = Route.useParams();

  return (
    <PageLayout className="bg-background h-full overflow-hidden">
      <LayoutErrorBoundary organizationId={organizationId}>
        <Suspense fallback={<SharedChatSkeleton />}>
          <SharedChatView
            organizationId={organizationId}
            shareToken={shareToken}
          />
        </Suspense>
      </LayoutErrorBoundary>
    </PageLayout>
  );
}
