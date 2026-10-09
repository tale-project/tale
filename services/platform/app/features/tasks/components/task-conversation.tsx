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
 * It opens on the newest page of comments; while earlier comments remain —
 * on the server, or loaded on an earlier visit — events older than the
 * oldest shown comment wait with them, so the history never shows a gap as
 * if nothing had been said.
 */

import { Row } from '@tale/ui/layout';
import { groupByDay } from '@tale/ui/thread/group-by-day';
import { ThreadDayDivider } from '@tale/ui/thread/thread-day-divider';
import { ThreadEventGroup } from '@tale/ui/thread/thread-event';
import { ThreadTime } from '@tale/ui/thread/thread-time';
import { useFormatDate } from '@tale/ui/use-format-date';
import { History } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

import { TASK_DISCUSSION_PAGE_SIZE, useTaskDiscussion } from '../hooks/queries';
import {
  useTaskActorDirectory,
  withTaskActorDirectory,
} from '../hooks/task-actor-directory-context';
import { useTaskHistoryAnchor } from '../hooks/use-task-history-anchor';
import {
  TaskCommentView,
  useTaskCommentDelete,
  type TaskCommentData,
} from './task-comments';
import { TaskHistoryEarlierButton } from './task-history-earlier-button';
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

/** A conversation opens on the discussion's newest page. Older comments kept
 * from an earlier visit wait behind "Show earlier comments" with the rest —
 * rendering every cached page at once made re-opening a long task the reader
 * had read back through take a second. */
/** The oldest moment shown when a conversation opens: the newest page's
 *  oldest comment, or everything when there is no more than a page. */
function openingFrom(newestFirst: readonly TaskCommentData[]): number {
  return newestFirst.length > TASK_DISCUSSION_PAGE_SIZE
    ? (newestFirst[TASK_DISCUSSION_PAGE_SIZE - 1]?.createdAt ??
        Number.NEGATIVE_INFINITY)
    : Number.NEGATIVE_INFINITY;
}

/** Three events in a row or more fold into one line that opens in place. */
const FOLD_EVENTS_AT = 3;
/** A comment by the same author this soon after their last, with nothing
 * between, continues it: no second identity row. */
const CONTINUATION_MS = 5 * 60_000;

type EventEntry = Extract<ConversationEntry, { kind: 'event' }>;

/** A day's entries as they render: a comment, a lone event, or a fold of
 * consecutive events. */
type Segment =
  | {
      kind: 'comment';
      key: string;
      entry: Extract<ConversationEntry, { kind: 'comment' }>;
      continuation: boolean;
    }
  | { kind: 'event'; key: string; entry: EventEntry }
  | { kind: 'fold'; key: string; events: EventEntry[] };

function segmentsOf(entries: readonly ConversationEntry[]): Segment[] {
  const segments: Segment[] = [];
  let run: EventEntry[] = [];
  const flush = () => {
    const first = run[0];
    if (first !== undefined && run.length >= FOLD_EVENTS_AT) {
      segments.push({ kind: 'fold', key: `fold-${first.key}`, events: run });
    } else {
      for (const entry of run) {
        segments.push({ kind: 'event', key: entry.key, entry });
      }
    }
    run = [];
  };
  let previous: ConversationEntry | undefined;
  for (const entry of entries) {
    if (entry.kind === 'event') {
      run.push(entry);
    } else {
      flush();
      const continuation =
        previous?.kind === 'comment' &&
        previous.comment.authorType === entry.comment.authorType &&
        previous.comment.authorId === entry.comment.authorId &&
        entry.at - previous.at < CONTINUATION_MS;
      segments.push({ kind: 'comment', key: entry.key, entry, continuation });
    }
    previous = entry;
  }
  flush();
  return segments;
}

export const TaskConversation = withTaskActorDirectory(TaskConversationContent);

function TaskConversationContent({
  taskId,
  outputFiles,
  organizationId,
  projectId,
  canComment,
  canWork = false,
  currentUserId,
  isAdmin,
}: {
  taskId: string;
  outputFiles?: ReadonlyArray<{ fileId: string; fileName: string }>;
  organizationId: string;
  projectId: string;
  canComment: boolean;
  /** The viewer may work the task: an admin's moderation passes it. */
  canWork?: boolean;
  currentUserId?: string;
  isAdmin?: boolean;
}) {
  const { t } = useT('tasks');
  const { formatDateHeader, formatDate } = useFormatDate();
  const {
    comments: loaded,
    hasEarlier: hasEarlierPages,
    isLoadingEarlier,
    loadEarlier,
  } = useTaskDiscussion(taskId);
  const { timeline, runs } = useTaskTimeline(taskId);
  const { requestDelete, dialog: deleteDialog } = useTaskCommentDelete();

  // Where the shown history starts, fixed per task when its comments first
  // arrive: a comment arriving later is newer and always shows, so it never
  // pushes an older one out of view.
  const [reveal, setReveal] = useState<{ taskId: string; from: number }>();
  if (reveal?.taskId !== taskId && loaded.length > 0) {
    setReveal({ taskId, from: openingFrom(loaded) });
  }
  const from = reveal?.taskId === taskId ? reveal.from : openingFrom(loaded);
  const newestFirst = useMemo(
    () => loaded.filter((comment) => comment.createdAt >= from),
    [loaded, from],
  );
  const hiddenLoaded = newestFirst.length < loaded.length;
  const hasEarlier = hiddenLoaded || hasEarlierPages;
  // Earlier comments already here show at once; only past them does the
  // conversation ask for another page.
  const showEarlier = () => {
    if (hiddenLoaded) {
      const next = loaded[newestFirst.length + TASK_DISCUSSION_PAGE_SIZE - 1];
      setReveal({
        taskId,
        from: next?.createdAt ?? Number.NEGATIVE_INFINITY,
      });
      return;
    }
    setReveal({ taskId, from: Number.NEGATIVE_INFINITY });
    loadEarlier();
  };
  const { historyRef, loadEarlierWithAnchor } = useTaskHistoryAnchor(
    newestFirst.at(-1)?.messageId,
    showEarlier,
    isLoadingEarlier,
  );

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

  // The comments the conversation opened with appear as they are; only one
  // that arrives after it slides in. Animating every comment of a long task
  // on open ran hundreds of animations at once, restyling each on every frame.
  const openedWith = useRef<ReadonlySet<string> | null>(null);
  if (openedWith.current === null && entries.length > 0) {
    openedWith.current = new Set(entries.map((entry) => entry.key));
  }
  const arrived = (key: string) =>
    openedWith.current !== null && !openedWith.current.has(key);

  // Day bands: each day's entries under one date pill, its events in bursts
  // folded and its comments joined to the one before when they continue it.
  const days = useMemo(
    () =>
      groupByDay(entries, (entry) => entry.at).map((day) => ({
        key: day.key,
        at: day.at,
        segments: segmentsOf(day.entries),
      })),
    [entries],
  );
  const { resolveActor, resolveAgentRunPreview } = useTaskActorDirectory(
    organizationId,
    projectId,
  );
  // Who a fold's events came from, each once, in order.
  const foldActors = (events: readonly EventEntry[]): string => {
    const names: string[] = [];
    for (const { item } of events) {
      const name =
        item.kind === 'agentRun'
          ? resolveAgentRunPreview(item.run).name
          : resolveActor(item.entry.actorType, item.entry.actorId).name;
      if (!names.includes(name)) names.push(name);
    }
    return names.join(', ');
  };
  const eventLine = (entry: EventEntry): ReactNode => (
    <TaskTimelineEntry
      item={entry.item}
      runs={runs}
      organizationId={organizationId}
      projectId={projectId}
      timeFormat="time"
    />
  );

  return (
    <section
      ref={historyRef}
      aria-label={t('detail.conversation')}
      className="flex flex-col"
    >
      {hasEarlier && (
        <Row gap={0} align="stretch" justify="center" className="mb-4">
          <TaskHistoryEarlierButton
            size="sm"
            isLoading={isLoadingEarlier}
            onLoadEarlier={loadEarlierWithAnchor}
          />
        </Row>
      )}

      {days.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          {canComment ? t('detail.conversationEmpty') : t('detail.noComments')}
        </p>
      ) : (
        <ol className="flex flex-col">
          {days.map((day) => (
            <li key={day.key}>
              <ThreadDayDivider>
                {formatDateHeader(new Date(day.at))}
              </ThreadDayDivider>
              <ol className="mb-6 flex flex-col gap-6">
                {day.segments.map((segment) => {
                  if (segment.kind === 'comment') {
                    return (
                      <li
                        key={segment.key}
                        data-task-history-entry
                        className={
                          arrived(segment.key)
                            ? 'animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none'
                            : undefined
                        }
                      >
                        <TaskCommentView
                          comment={segment.entry.comment}
                          taskId={taskId}
                          outputFiles={outputFiles}
                          organizationId={organizationId}
                          projectId={projectId}
                          canComment={canComment}
                          canWork={canWork}
                          continuation={segment.continuation}
                          timeFormat="time"
                          {...(currentUserId !== undefined
                            ? { currentUserId }
                            : {})}
                          {...(isAdmin !== undefined ? { isAdmin } : {})}
                          onRequestDelete={requestDelete}
                        />
                      </li>
                    );
                  }
                  if (segment.kind === 'event') {
                    return (
                      <li
                        key={segment.key}
                        data-task-history-entry
                        className="-my-3"
                      >
                        {eventLine(segment.entry)}
                      </li>
                    );
                  }
                  const firstAt = segment.events[0]?.at ?? 0;
                  const lastAt = segment.events.at(-1)?.at ?? firstAt;
                  return (
                    <li
                      key={segment.key}
                      data-task-history-entry
                      className="-my-3"
                    >
                      <ThreadEventGroup
                        icon={History}
                        summary={
                          <>
                            {t('timeline.updates', {
                              count: segment.events.length,
                            })}
                            <span aria-hidden="true"> · </span>
                            {foldActors(segment.events)}
                          </>
                        }
                        time={
                          <>
                            <ThreadTime value={firstAt} />
                            {/* A span only when the clock reads two times. */}
                            {formatDate(new Date(lastAt), 'time') !==
                              formatDate(new Date(firstAt), 'time') && (
                              <>
                                {'–'}
                                <ThreadTime value={lastAt} />
                              </>
                            )}
                          </>
                        }
                      >
                        {segment.events.map((entry) => (
                          <li key={entry.key}>{eventLine(entry)}</li>
                        ))}
                      </ThreadEventGroup>
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>
      )}
      {deleteDialog}
    </section>
  );
}
