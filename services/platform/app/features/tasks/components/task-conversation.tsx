'use client';

/**
 * A task's discussion read as a conversation — how the task page shows it.
 *
 * A task is a structured chat: the comments people and agents write, and
 * what happened to the task along the way (status moves, assignments, agent
 * runs), in the order it happened, oldest first with the newest at the foot
 * where the composer answers it. Each day opens under a date pill, the way a
 * customer conversation reads, and the events sit between the comments as
 * quiet one-line notes instead of a separate log.
 *
 * Only the loaded pages of the discussion are shown; while earlier comments
 * remain, events older than the oldest loaded comment wait with them, so the
 * history never shows a gap as if nothing had been said.
 */

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useMemo } from 'react';

import { ConversationDateHeader } from '@/app/features/conversations/components/conversation-message-layout';
import { useT } from '@/lib/i18n/client';

import { useTaskDiscussion } from '../hooks/queries';
import {
  TaskCommentView,
  useTaskCommentDelete,
  type TaskCommentData,
} from './task-comments';
import {
  TaskTimelineEntry,
  timelineItemKey,
  timelineItemTime,
  useTaskTimeline,
} from './task-timeline';

type TimelineItem = ReturnType<typeof useTaskTimeline>['timeline'][number];

type ConversationEntry =
  | { kind: 'comment'; at: number; key: string; comment: TaskCommentData }
  | { kind: 'event'; at: number; key: string; item: TimelineItem };

/** Activity entries a comment already speaks for. */
const COMMENT_ACTIONS = new Set([
  'comment.added',
  'comment.edited',
  'comment.deleted',
]);

function dayOf(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function TaskConversation({
  taskId,
  organizationId,
  projectId,
  canComment,
  currentUserId,
  isAdmin,
}: {
  taskId: string;
  organizationId: string;
  projectId: string;
  canComment: boolean;
  currentUserId?: string;
  isAdmin?: boolean;
}) {
  const { t } = useT('tasks');
  const { formatDateHeader } = useFormatDate();
  const {
    comments: newestFirst,
    hasEarlier,
    isLoadingEarlier,
    loadEarlier,
  } = useTaskDiscussion(taskId);
  const { timeline, runs } = useTaskTimeline(taskId);
  const { requestDelete, dialog: deleteDialog } = useTaskCommentDelete();

  const entries = useMemo((): ConversationEntry[] => {
    const oldestLoaded = newestFirst.at(-1)?.createdAt;
    const events = timeline
      // The comment itself is in the conversation; its "comment added"
      // activity entry would only say so twice.
      .filter(
        (item) =>
          item.kind !== 'activity' || !COMMENT_ACTIONS.has(item.entry.action),
      )
      .map((item) => ({
        kind: 'event' as const,
        at: timelineItemTime(item),
        key: timelineItemKey(item),
        item,
      }))
      .filter(
        (entry) =>
          !hasEarlier || oldestLoaded === undefined || entry.at >= oldestLoaded,
      );
    const comments = newestFirst.map((comment) => ({
      kind: 'comment' as const,
      at: comment.createdAt,
      key: comment.messageId,
      comment,
    }));
    return [...comments, ...events].sort((a, b) => a.at - b.at);
  }, [newestFirst, timeline, hasEarlier]);

  // Day bands: each day's entries under one date pill.
  const days = useMemo(() => {
    const bands: { day: string; at: number; entries: ConversationEntry[] }[] =
      [];
    for (const entry of entries) {
      const day = dayOf(entry.at);
      const band = bands.at(-1);
      if (band !== undefined && band.day === day) band.entries.push(entry);
      else bands.push({ day, at: entry.at, entries: [entry] });
    }
    return bands;
  }, [entries]);

  return (
    <section aria-label={t('detail.conversation')} className="flex flex-col">
      {hasEarlier && (
        <Row gap={0} align="stretch" justify="center" className="mb-4">
          <Button
            variant="secondary"
            size="sm"
            isLoading={isLoadingEarlier}
            disabled={isLoadingEarlier}
            onClick={loadEarlier}
          >
            {t('detail.showEarlierComments')}
          </Button>
        </Row>
      )}

      {days.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          {canComment ? t('detail.conversationEmpty') : t('detail.noComments')}
        </p>
      ) : (
        <ol className="flex flex-col">
          {days.map((band) => (
            <li key={band.day}>
              <ConversationDateHeader>
                {formatDateHeader(new Date(band.at))}
              </ConversationDateHeader>
              <ol className="mb-6 flex flex-col gap-4">
                {band.entries.map((entry) =>
                  entry.kind === 'comment' ? (
                    <li
                      key={entry.key}
                      className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none"
                    >
                      <TaskCommentView
                        comment={entry.comment}
                        organizationId={organizationId}
                        projectId={projectId}
                        canComment={canComment}
                        {...(currentUserId !== undefined
                          ? { currentUserId }
                          : {})}
                        {...(isAdmin !== undefined ? { isAdmin } : {})}
                        onRequestDelete={requestDelete}
                      />
                    </li>
                  ) : (
                    <li key={entry.key} className="pl-0.5">
                      <TaskTimelineEntry
                        item={entry.item}
                        runs={runs}
                        organizationId={organizationId}
                        projectId={projectId}
                      />
                    </li>
                  ),
                )}
              </ol>
            </li>
          ))}
        </ol>
      )}
      {deleteDialog}
    </section>
  );
}
