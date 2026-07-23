'use client';

/**
 * The chat sub-panel: every thread the user can open, newest first.
 *
 * A row says three things — the thread's title, whether it runs in a sandbox,
 * and whether a turn is in flight right now. The generating marker comes from
 * the same signal the thread view uses, so a thread never looks idle in the
 * list while it streams in the pane.
 */

import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { Boxes, Plus } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { ChatThreadSummary } from '../types';

interface ThreadListProps {
  organizationId: string;
  threads: readonly ChatThreadSummary[];
  activeThreadId?: string;
  /** False while the chat backend has not answered — the list says so. */
  available?: boolean;
  onNewChat?: () => void;
}

export function ThreadList({
  organizationId,
  threads,
  activeThreadId,
  available = true,
  onNewChat,
}: ThreadListProps) {
  const { t } = useT('chat');

  return (
    <Stack gap={2} className="min-h-0 flex-1 px-2.5 pt-2.5 pb-3.5">
      <Button
        variant="secondary"
        size="sm"
        onClick={onNewChat}
        disabled={!available}
        className="w-full justify-start"
      >
        <Plus aria-hidden className="size-4" />
        {t('newChat')}
      </Button>

      {/* The panel's landmark already carries this name, so the visible
          label is chrome rather than a heading — it does not add a level to
          the page outline. */}
      <Text
        variant="muted"
        className="px-2 text-xs font-medium tracking-wide uppercase"
      >
        {t('chatsSection')}
      </Text>

      {!available ? (
        <Text variant="muted" className="px-2 text-sm">
          {t('backendUnavailable.title')}
        </Text>
      ) : threads.length === 0 ? (
        <Text variant="muted" className="px-2 text-sm">
          {t('history.empty')}
        </Text>
      ) : (
        <Stack
          as="ul"
          gap={0}
          className="min-h-0 flex-1 gap-0.5 overflow-y-auto"
        >
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link
                to="/dashboard/$id/chat/$threadId"
                params={{ id: organizationId, threadId: thread.id }}
                aria-current={thread.id === activeThreadId ? 'page' : undefined}
                className={cn(
                  'focus-visible:ring-ring flex min-h-8 items-center gap-1.5 rounded-md px-2 text-sm focus-visible:ring-2 focus-visible:outline-none',
                  thread.id === activeThreadId
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                {thread.kind === 'sandbox' && (
                  <Boxes
                    aria-label={t('sandbox.label')}
                    className="size-3.5 shrink-0"
                  />
                )}
                <span className="truncate">
                  {thread.title ?? t('history.untitled')}
                </span>
                {thread.generating && (
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                    {t('history.generating')}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
