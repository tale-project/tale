'use client';

/**
 * The project's Chats tab: the caller's own conversations filed here — each
 * with the "share with project" switch — and, below, the ones other members
 * shared. Reads the chat-v2 tables through `listThreadsForProject`; the
 * switch writes the owner-gated share flag on the thread itself.
 */

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
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useSetThreadSharedWithProject } from '../hooks/mutations';
import { useProjectChatThreads } from '../hooks/queries';

interface ProjectThreadsTabProps {
  organizationId: string;
  projectId: string;
}

export function ProjectThreadsTab({
  organizationId,
  projectId,
}: ProjectThreadsTabProps) {
  const { t } = useT('projects');
  const navigate = useNavigate();
  const { mine, shared: sharedThreads } = useProjectChatThreads(projectId);
  const { mutateAsync: setShared } = useSetThreadSharedWithProject();

  const handleNewChat = () => {
    void navigate({
      to: '/dashboard/$id/chat',
      params: { id: organizationId },
      search: { projectId: projectId },
    });
  };

  const handleToggleShare = async (threadId: string, nextShared: boolean) => {
    try {
      await setShared({ organizationId, threadId, shared: nextShared });
      toast({
        title: nextShared
          ? t('threads.shareSuccess')
          : t('threads.unshareSuccess'),
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
        description={t('threads.subtitle')}
        action={
          <Button onClick={handleNewChat}>{t('overview.newChatCta')}</Button>
        }
      />

      <FormSection>
        {mine.length === 0 ? (
          <EmptyPlaceholder icon={MessageSquare}>
            {t('threads.emptyYours')}
          </EmptyPlaceholder>
        ) : (
          <div className="flex flex-col gap-3">
            <Text variant="muted" className="text-sm">
              {t('threads.shareToggleDisclosure')}
            </Text>
            <div className="divide-y rounded-lg border">
              {mine.map((thread) => (
                <HStack
                  key={thread.id}
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
                      threadId: thread.id,
                    }}
                    className="min-w-0 flex-1 truncate text-sm hover:underline"
                  >
                    {thread.title ?? thread.id}
                  </Link>
                  <Switch
                    checked={thread.sharedWithProject === true}
                    onCheckedChange={(checked) =>
                      void handleToggleShare(thread.id, checked)
                    }
                    label={t('threads.shareToggle')}
                  />
                </HStack>
              ))}
            </div>
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
                key={thread.id}
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
                    threadId: thread.id,
                  }}
                  className="min-w-0 flex-1 truncate text-sm hover:underline"
                >
                  {thread.title ?? thread.id}
                </Link>
                <Text variant="caption">
                  {thread.authorName ?? thread.userId.slice(0, 8)}
                </Text>
              </HStack>
            ))}
          </div>
        )}
      </PageSection>
    </ContentArea>
  );
}
