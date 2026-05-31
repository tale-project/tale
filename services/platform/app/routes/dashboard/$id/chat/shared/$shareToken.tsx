import { SkeletonText } from '@tale/ui/skeleton';
import { createFileRoute } from '@tanstack/react-router';

import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { SuspenseBoundary } from '@/app/components/error-boundaries/core/suspense-boundary';
import { PageLayout } from '@/app/components/layout/page-layout';
import { SharedChatView } from '@/app/features/chat/components/shared-chat-view';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/chat/shared/$shareToken')({
  head: () => ({
    meta: seo('shared-chat'),
  }),
  component: SharedChatLayout,
});

function SharedChatLayout() {
  const { id: organizationId, shareToken } = Route.useParams();

  return (
    <PageLayout className="bg-background h-full overflow-hidden">
      <LayoutErrorBoundary organizationId={organizationId}>
        <SuspenseBoundary
          fallback={
            <div className="flex h-full flex-col p-4 sm:p-6">
              <SkeletonText lines={3} />
            </div>
          }
        >
          <SharedChatView
            organizationId={organizationId}
            shareToken={shareToken}
          />
        </SuspenseBoundary>
      </LayoutErrorBoundary>
    </PageLayout>
  );
}
