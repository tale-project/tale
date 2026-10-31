'use client';

import { toast } from '@tale/ui/use-toast';
import {
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';

import { TaskHistoryEarlierButton } from '@/app/features/tasks/components/task-history-earlier-button';
import { useTaskHistoryAnchor } from '@/app/features/tasks/hooks/use-task-history-anchor';
import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import { useEarlierChatMessages } from '../data/chat-backend';

/** What marks a row of the transcript, one below the other. */
const CHAT_ROW_SELECTOR = '[data-message-key]';

interface ChatEarlierMessagesProps {
  organizationId: string;
  threadId: string | undefined;
  oldestId: string | undefined;
  historyRef: RefObject<HTMLElement | null>;
}

/** Mounted while the transcript has rows, with or without a button: the read
 * that lands the last page still has a place to hold. */
function ChatEarlierMessages({
  organizationId,
  threadId,
  oldestId,
  historyRef,
}: ChatEarlierMessagesProps) {
  const { t } = useT('chat');
  const { hasMore, loading, loadEarlier } = useEarlierChatMessages(
    organizationId,
    threadId,
  );
  const readEarlier = useCallback(() => {
    loadEarlier().catch((error: unknown) => {
      console.warn('[chat] reading earlier messages failed', error);
      toast({
        title: t('earlierMessagesFailed'),
        description: failureDetail(error),
        variant: 'destructive',
      });
    });
  }, [loadEarlier, t]);
  const { loadEarlierWithAnchor } = useTaskHistoryAnchor(
    oldestId,
    readEarlier,
    loading,
    { entrySelector: CHAT_ROW_SELECTOR, historyRef },
  );
  if (!hasMore) return null;
  return (
    <div className="mb-3 flex justify-center">
      <TaskHistoryEarlierButton
        size="sm"
        isLoading={loading}
        onLoadEarlier={loadEarlierWithAnchor}
        label={t('showEarlierMessages')}
      />
    </div>
  );
}

/**
 * The transcript opens on its newest messages; `earlier` reads the page
 * before the oldest one shown, one page at a time, while older ones remain.
 * It is the task history's way back: a pending read keeps the button in the
 * keyboard's place while it blocks a repeat (native disabled would move focus
 * out of the log), and the row being read holds still while the older rows
 * land in front of it — `historyRef` is the list it measures. A failed read
 * says so once; the rows stay.
 *
 * `earlier` goes inside the log, above its rows: its layout effect places the
 * view on the row being read before the transcript's own, so the row waker
 * wakes the rows the reader sees, not the ones that landed at the top.
 */
export function useChatEarlierMessages(
  organizationId: string,
  threadId: string | undefined,
  oldestId: string | undefined,
): { historyRef: RefObject<HTMLElement | null>; earlier: ReactNode } {
  const historyRef = useRef<HTMLElement | null>(null);
  // Built once per oldest row: the stream's pushes re-render the transcript.
  const earlier = useMemo(
    () => (
      <ChatEarlierMessages
        organizationId={organizationId}
        threadId={threadId}
        oldestId={oldestId}
        historyRef={historyRef}
      />
    ),
    [organizationId, threadId, oldestId],
  );
  return { historyRef, earlier };
}
