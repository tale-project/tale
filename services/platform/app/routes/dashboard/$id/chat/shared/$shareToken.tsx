import { Button } from '@tale/ui/button';
import {
  createFileRoute,
  useCanGoBack,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import { X } from 'lucide-react';
import { useCallback } from 'react';

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
  const { t: tCommon } = useT('common');
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();

  const handleClose = useCallback(() => {
    if (canGoBack) {
      router.history.back();
    } else {
      void navigate({ to: '/dashboard/$id', params: { id: organizationId } });
    }
  }, [canGoBack, router, navigate, organizationId]);

  return (
    <PageLayout
      header={
        <AdaptiveHeaderRoot standalone={false}>
          <AdaptiveHeaderTitle>{t('share.sharedChat')}</AdaptiveHeaderTitle>
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            onClick={handleClose}
            aria-label={tCommon('actions.close')}
            className="-mr-1 ml-auto"
          />
        </AdaptiveHeaderRoot>
      }
      organizationId={organizationId}
    >
      <SharedChatView organizationId={organizationId} shareToken={shareToken} />
    </PageLayout>
  );
}
