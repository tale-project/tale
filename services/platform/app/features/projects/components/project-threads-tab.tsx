'use client';

import { Heading } from '@tale/ui/heading';
import { Stack, HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { ConvexError } from 'convex/values';
import { MessageSquare } from 'lucide-react';

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
  const { data: currentUser } = useCurrentUser();
  const userId = currentUser?.userId;
  const { yours, shared: sharedThreads } = useProjectThreadSegments(
    projectId,
    userId,
  );
  const { mutateAsync: setShared } = useSetThreadSharedWithProject();

  const handleToggleShare = async (threadId: string, nextShared: boolean) => {
    try {
      await setShared({ threadId, shared: nextShared });
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
    <Stack gap={6} className="p-6">
      <section>
        <Heading level={2} size="base" className="mb-3">
          {t('threads.yourChats')}
        </Heading>
        {yours.length === 0 ? (
          <Text variant="muted">{t('threads.emptyYours')}</Text>
        ) : (
          <Stack gap={2}>
            {yours.map((thread) => (
              <HStack
                key={thread._id}
                gap={3}
                align="center"
                className="border-border rounded-md border p-3"
              >
                <MessageSquare className="text-muted-foreground size-4 shrink-0" />
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
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={thread.sharedWithProject === true}
                    onChange={(e) =>
                      handleToggleShare(thread.threadId, e.target.checked)
                    }
                  />
                  <span>{t('threads.shareToggle')}</span>
                </label>
              </HStack>
            ))}
          </Stack>
        )}
        <Text variant="caption" className="text-muted-foreground mt-2">
          {t('threads.shareToggleDisclosure')}
        </Text>
      </section>

      <section>
        <Heading level={2} size="base" className="mb-3">
          {t('threads.sharedWithProject')}
        </Heading>
        {sharedThreads.length === 0 ? (
          <Text variant="muted">{t('threads.emptyShared')}</Text>
        ) : (
          <Stack gap={2}>
            {sharedThreads.map((thread) => (
              <HStack
                key={thread._id}
                gap={3}
                align="center"
                className="border-border rounded-md border p-3"
              >
                <MessageSquare className="text-muted-foreground size-4 shrink-0" />
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
          </Stack>
        )}
      </section>
    </Stack>
  );
}
