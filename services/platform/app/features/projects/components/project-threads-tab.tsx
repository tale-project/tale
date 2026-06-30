'use client';

import { Button } from '@tale/ui/button';
import { EmptyPlaceholder } from '@tale/ui/empty-placeholder';
import { HStack } from '@tale/ui/layout';
import { PageSection } from '@tale/ui/page-section';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { Text } from '@tale/ui/text';
import { Link, useNavigate } from '@tanstack/react-router';
import { ConvexError } from 'convex/values';
import { MessageSquare } from 'lucide-react';

import { ContentArea } from '@/app/components/layout/content-area';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Switch } from '@/app/components/ui/forms/switch';
import { useCurrentUser } from '@/app/hooks/use-current-user';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useSetThreadSharedWithProject } from '../hooks/mutations';
import { useProjectThreadSegments } from '../hooks/queries';

interface ProjectThreadsTabProps {
  organizationId: string;
  projectId: Id<'projects'>;
}

export function ProjectThreadsTab({
  organizationId,
  projectId,
}: ProjectThreadsTabProps) {
  const { t } = useT('projects');
  const navigate = useNavigate();
  const { data: currentUser } = useCurrentUser();
  const userId = currentUser?.userId;
  const { yours, shared: sharedThreads } = useProjectThreadSegments(
    projectId,
    userId,
  );
  const { mutateAsync: setShared } = useSetThreadSharedWithProject();

  const handleNewChat = () => {
    void navigate({
      to: '/dashboard/$id/chat',
      params: { id: organizationId },
      search: { projectId: String(projectId) },
    });
  };

  const handleToggleShare = async (threadId: string, nextShared: boolean) => {
    try {
      const { autoDisabledPersonalization } = await setShared({
        threadId,
        shared: nextShared,
      });
      toast({
        title: nextShared
          ? t('threads.shareSuccess')
          : t('threads.unshareSuccess'),
        description: autoDisabledPersonalization
          ? t('threads.shareDisabledPersonalization')
          : undefined,
        variant: 'success',
      });
    } catch (error) {
      if (error instanceof ConvexError) {
        const code = error.data?.code;
        if (code) {
          toast({
            title: t('errors.' + code, {
              defaultValue: t('threads.shareError'),
            }),
            variant: 'destructive',
          });
          return;
        }
      }
      console.error('setThreadSharedWithProject failed', error);
      toast({ title: t('threads.shareError'), variant: 'destructive' });
    }
  };

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('threads.yourChats')}
        description={t('threads.shareToggleDisclosure')}
        action={
          <Button onClick={handleNewChat}>{t('overview.newChatCta')}</Button>
        }
      />

      <FormSection>
        {yours.length === 0 ? (
          <EmptyPlaceholder icon={MessageSquare}>
            {t('threads.emptyYours')}
          </EmptyPlaceholder>
        ) : (
          <div className="divide-y rounded-lg border">
            {yours.map((thread) => (
              <HStack
                key={thread._id}
                gap={3}
                align="center"
                className="px-4 py-3"
              >
                <MessageSquare
                  className="text-muted-foreground size-4 shrink-0"
                  aria-hidden="true"
                />
                <Link
                  to="/dashboard/$id/chat/$threadId"
                  params={{
                    id: organizationId,
                    threadId: thread.threadId,
                  }}
                  className="min-w-0 flex-1 truncate text-sm hover:underline"
                >
                  {thread.title ?? thread.threadId}
                </Link>
                <Switch
                  checked={thread.sharedWithProject === true}
                  onCheckedChange={(checked) =>
                    void handleToggleShare(thread.threadId, checked)
                  }
                  label={t('threads.shareToggle')}
                />
              </HStack>
            ))}
          </div>
        )}
      </FormSection>

      <PageSection
        title={t('threads.sharedWithProject')}
        gap={6}
        className="mt-8 border-t pt-8"
      >
        {sharedThreads.length === 0 ? (
          <EmptyPlaceholder icon={MessageSquare}>
            {t('threads.emptyShared')}
          </EmptyPlaceholder>
        ) : (
          <div className="divide-y rounded-lg border">
            {sharedThreads.map((thread) => (
              <HStack
                key={thread._id}
                gap={3}
                align="center"
                className="px-4 py-3"
              >
                <MessageSquare
                  className="text-muted-foreground size-4 shrink-0"
                  aria-hidden="true"
                />
                <Link
                  to="/dashboard/$id/chat/$threadId"
                  params={{
                    id: organizationId,
                    threadId: thread.threadId,
                  }}
                  className="min-w-0 flex-1 truncate text-sm hover:underline"
                >
                  {thread.title ?? thread.threadId}
                </Link>
                <Text variant="caption">{thread.userId.slice(0, 8)}</Text>
              </HStack>
            ))}
          </div>
        )}
      </PageSection>
    </ContentArea>
  );
}
