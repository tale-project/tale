'use client';

import { Alert } from '@tale/ui/alert';
import { Stack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';

import { useActorDirectory } from '@/app/features/tasks/hooks/use-actor-directory';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { toSettledItems } from '../lib/thread-view-core';
import { MessageThread } from './message-thread';

/**
 * A shared chat: the org-internal, read-only SNAPSHOT a member published.
 * The token in the URL is the credential; the backend re-checks that the
 * caller belongs to the thread's organization and cuts the transcript at
 * `sharedAt`, so this view renders exactly what was published — no composer,
 * no live tail. An unknown or taken-down link reads the same as never-shared.
 */
export function SharedChatView({
  organizationId,
  shareToken,
}: {
  organizationId: string;
  shareToken: string;
}) {
  const { t } = useT('chat');
  const { formatDate } = useFormatDate();
  const sharedQuery = useConvexQuery(api.chat.threads.getSharedThread, {
    shareToken,
  });
  const { resolveActor } = useActorDirectory(organizationId);

  if (sharedQuery.isPending) {
    return (
      <Skeletonize loading>
        <Stack gap={3} className="mx-auto w-full max-w-3xl px-4 py-6">
          <SkeletonText lines={1} />
          <SkeletonText lines={6} />
        </Stack>
      </Skeletonize>
    );
  }

  const shared = sharedQuery.data;
  if (sharedQuery.isError || shared == null) {
    return (
      <Stack gap={3} className="mx-auto w-full max-w-3xl px-4 py-6">
        <Alert variant="destructive" description={t('share.notFound')} />
      </Stack>
    );
  }

  const sharerName = resolveActor('user', shared.sharedBy).name;

  return (
    <Stack gap={0} className="h-full min-h-0">
      <Stack gap={1} className="mx-auto w-full max-w-3xl px-4 pt-6">
        <Text as="h3" className="text-lg font-semibold">
          {shared.title ?? t('share.sharedChat')}
        </Text>
        <Text as="p" variant="muted" className="text-sm">
          {t('share.byline', {
            name: sharerName,
            date: formatDate(new Date(shared.sharedAt), 'long'),
          })}
        </Text>
      </Stack>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageThread messages={toSettledItems(shared.messages)} />
      </div>
    </Stack>
  );
}
