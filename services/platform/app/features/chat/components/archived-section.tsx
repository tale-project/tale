'use client';

/**
 * The ARCHIVED section — a collapsible drawer pinned under the thread list.
 *
 * Archived chats grow without bound, so the section is lazy and paginated:
 * collapsed it costs the panel nothing (the read is skipped), expanded it
 * loads a page at a time, each page keeping its own live watch so an
 * unarchive reflects immediately. The expand choice persists per device.
 */

import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { ChatRowsSkeleton } from '@/app/components/layout/chat-history-skeleton';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useArchivedThreads } from '../data/chat-backend';
import { useThreadListFrame } from './thread-list-context';
import { ThreadRow } from './thread-row';

export function ArchivedSection() {
  const { t } = useT('chat');
  const [expanded, setExpanded] = usePersistedState(
    'chat-sidebar-archived-expanded',
    false,
  );
  // The `updatedAt` cursors of the extra pages the user has loaded, in order.
  // Each page renders as its own component with its own live watch.
  const [cursors, setCursors] = useState<readonly number[]>([]);

  return (
    <section className="border-border mt-2 shrink-0 border-t pt-2">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="text-muted-foreground/70 hover:text-foreground flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-md px-2 text-[11px] font-normal tracking-wider uppercase transition-colors"
      >
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none',
            !expanded && '-rotate-90',
          )}
        />
        {t('archived.title')}
      </button>
      {expanded && (
        <div className="max-h-64 overflow-y-auto">
          <ArchivedPage
            cursor={undefined}
            isLastLoaded={cursors.length === 0}
            onLoadMore={(next) => setCursors([next])}
          />
          {cursors.map((cursor, index) => (
            <ArchivedPage
              key={cursor}
              cursor={cursor}
              isLastLoaded={index === cursors.length - 1}
              onLoadMore={(next) =>
                setCursors((previous) => [...previous, next])
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** One loaded page of archived rows, plus the Load-more affordance when it is
 * the newest page and more exist. */
function ArchivedPage({
  cursor,
  isLastLoaded,
  onLoadMore,
}: {
  cursor: number | undefined;
  isLastLoaded: boolean;
  onLoadMore: (nextCursor: number) => void;
}) {
  const { t } = useT('chat');
  const { organizationId } = useThreadListFrame();
  const page = useArchivedThreads(organizationId, {
    enabled: true,
    ...(cursor !== undefined ? { cursor } : {}),
  });

  if (page.status !== 'ready') {
    return (
      <Skeletonize loading className="flex shrink-0 flex-col gap-0.5">
        <ChatRowsSkeleton />
      </Skeletonize>
    );
  }

  const { rows, nextCursor } = page.data;

  return (
    <>
      {rows.length === 0 && cursor === undefined ? (
        <Text
          as="div"
          variant="caption"
          className="text-muted-foreground/70 px-2 py-1.5"
        >
          {t('archived.empty')}
        </Text>
      ) : (
        <Stack as="ul" gap={0} className="gap-0.5">
          {rows.map((thread) => (
            <ThreadRow key={thread.id} thread={thread} variant="archived" />
          ))}
        </Stack>
      )}
      {isLastLoaded && nextCursor !== null && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onLoadMore(nextCursor)}
          className="text-muted-foreground h-7 w-full text-xs"
        >
          {t('history.loadMore')}
        </Button>
      )}
    </>
  );
}
