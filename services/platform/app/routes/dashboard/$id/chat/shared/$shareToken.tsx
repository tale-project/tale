import { createFileRoute } from '@tanstack/react-router';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { SharedChatView } from '@/app/features/chat/components/shared-chat-view';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/chat/shared/$shareToken')({
  component: SharedChatPage,
});

function SharedChatPage() {
  const { id: organizationId, shareToken } = Route.useParams();
  const { t } = useT('chat');

  return (
    <PageLayout
      header={
        <AdaptiveHeaderRoot standalone={false}>
          <AdaptiveHeaderTitle>{t('share.sharedChat')}</AdaptiveHeaderTitle>
        </AdaptiveHeaderRoot>
      }
      organizationId={organizationId}
    >
      <SharedChatView organizationId={organizationId} shareToken={shareToken} />
    </PageLayout>
  );
}
