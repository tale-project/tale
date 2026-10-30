'use client';

import { Alert } from '@tale/ui/alert';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { cn } from '@tale/ui/cn';
import { Stack } from '@tale/ui/layout';
import { SKELETON_PULSE, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { THREAD_COLUMN_CLASS } from '@tale/ui/thread/layout';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useRef, type ReactNode } from 'react';

import { useActorDirectory } from '@/app/features/tasks/hooks/use-actor-directory';
import { failureDetail } from '@/app/lib/backend/adapters';
import { sharedThreadQuery } from '@/app/lib/backend/chat';
import { readStateOf } from '@/app/lib/backend/read-state';
import { useT } from '@/lib/i18n/client';

import { useChatQueryClient } from '../data/chat-backend';
import { toSettledItems } from '../lib/thread-view-core';
import { MessageThread } from './message-thread';

/**
 * A shared chat: the org-internal, read-only SNAPSHOT a member published.
 * The token in the URL is the credential; the backend re-checks that the
 * caller belongs to the thread's organization and cuts the transcript at
 * `sharedAt`, so this view renders exactly what was published — no composer,
 * no live tail. An unknown or taken-down link reads the same as never-shared.
 * A read that failed got no such answer: it is named, with its cause and Try
 * again, never as a withdrawn link (#4535); a refresh that fails keeps the
 * snapshot on screen under a notice that it may be out of date.
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
  const sharedQuery = useQuery(
    sharedThreadQuery(organizationId, shareToken),
    useChatQueryClient(),
  );
  const { refetch } = sharedQuery;
  const { resolveActor } = useActorDirectory(organizationId);
  // The flags hold through a retry, which react-query starts from `pending`.
  const read = readStateOf(sharedQuery);
  // What the last failure says about itself — a lost connection, an ended
  // session; nothing for a fault. Kept through a retry, which clears the
  // read's error.
  const failureRef = useRef<string | undefined>(undefined);
  if (sharedQuery.isError) {
    failureRef.current = failureDetail(sharedQuery.error);
  }
  // Where a Try again that gave way hands its focus: the view, whatever
  // replaced the notice in it.
  const viewRef = useRef<HTMLDivElement>(null);
  const focusView = useCallback(() => viewRef.current?.focus(), []);

  const readFailure = (read.unavailable || read.stale) && (
    <CatalogLoadError
      // Each failure is announced again; Try again keeps its node, and the
      // focus on it, through a retry that fails again.
      failureKey={read.failureCount}
      message={[
        t(read.stale ? 'share.refreshFailed' : 'share.loadFailed'),
        failureRef.current,
      ]
        .filter(Boolean)
        .join(' ')}
      onRetry={() => void refetch()}
      isRetrying={read.retrying}
      onFocusLost={focusView}
    />
  );

  // One region holds every state, so the focus handed on lands in the same
  // named place whatever replaced the notice.
  const view = (body: ReactNode) => (
    <Stack
      ref={viewRef}
      role="region"
      aria-label={t('share.sharedChat')}
      tabIndex={-1}
      gap={0}
      // The title answers to the same container as the transcript under it,
      // so the two keep one inset at every width.
      className="@container h-full min-h-0 outline-none"
    >
      {body}
    </Stack>
  );

  if (read.unavailable) {
    return view(
      <Stack gap={3} className="mx-auto w-full max-w-3xl px-4 py-6">
        {readFailure}
      </Stack>,
    );
  }

  if (sharedQuery.isPending) {
    return view(
      <Skeletonize loading>
        <Stack gap={3} className="mx-auto w-full max-w-3xl px-4 py-6">
          <SkeletonText lines={1} />
          <SkeletonText lines={6} />
        </Stack>
      </Skeletonize>,
    );
  }

  // The door's never-shared answer. A refresh that failed after it leaves
  // that answer standing.
  const shared = sharedQuery.data;
  if (shared == null) {
    return view(
      <Stack gap={3} className="mx-auto w-full max-w-3xl px-4 py-6">
        <Alert variant="destructive" description={t('share.notFound')} />
      </Stack>,
    );
  }

  const sharer = resolveActor('user', shared.sharedBy);
  const sharedOn = formatDate(new Date(shared.sharedAt), 'long');

  return view(
    <>
      <Stack gap={1} className={cn(THREAD_COLUMN_CLASS, 'pt-6')}>
        <Text as="h3" className="text-lg font-semibold">
          {shared.title ?? t('share.sharedChat')}
        </Text>
        <Text as="p" variant="muted" className="text-sm">
          {sharer.standing === 'pending' ? (
            // Who shared it waits for the member directory: a placeholder,
            // never a guess.
            <span
              aria-hidden="true"
              className={cn(SKELETON_PULSE, 'inline-block h-3.5 w-48 rounded')}
            />
          ) : sharer.standing === 'former' ? (
            t('share.bylineFormerMember', { date: sharedOn })
          ) : (
            t('share.byline', { name: sharer.name, date: sharedOn })
          )}
        </Text>
      </Stack>
      {readFailure && (
        <div className={cn(THREAD_COLUMN_CLASS, 'pt-4')}>{readFailure}</div>
      )}
      {/* MessageThread owns the scrolling — a second scroller here would
          nest two and strand the jump-to-bottom affordance. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <MessageThread messages={toSettledItems(shared.messages)} />
      </div>
    </>,
  );
}
