'use client';

import { formatTaskIdentifier } from '@tale/shared/utils/project-key';
import { useMemo, useState } from 'react';

import {
  useArchivedThreads,
  useChatProjects,
  useChatThreads,
  useChatThreadsRetry,
} from '@/app/features/chat/data/chat-backend';
import type {
  ChatProjectSummary,
  ChatThreadSummary,
} from '@/app/features/chat/types';
import { useListConversationsPaginated } from '@/app/features/conversations/hooks/queries';
import { useInboxAvailability } from '@/app/features/conversations/hooks/use-inbox-availability';
import { useTasksAcrossProjects } from '@/app/features/tasks/hooks/queries';
import type { TaskStatus } from '@/app/features/tasks/lib/display';
import { useCurrentUser } from '@/app/hooks/use-current-user';

import type {
  HomeChatItem,
  HomeConversationItem,
  HomeItem,
  HomeTaskItem,
  InboxStatus,
} from '../lib/home-items';

/** The statuses a task can still move out of — the work that is not done. */
const OPEN_TASK_STATUSES: TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
];

const INBOX_PAGE_SIZE = 30;

const NO_PROJECTS: readonly ChatProjectSummary[] = [];

export interface HomeData {
  readonly items: readonly HomeItem[];
  /** The chat rows' full summaries — the row menu acts on these. */
  readonly threadsById: ReadonlyMap<string, ChatThreadSummary>;
  readonly projects: readonly ChatProjectSummary[];
  /** Per-source readiness, so each masks only its own rows while it loads. */
  readonly loading: {
    readonly chats: boolean;
    readonly tasks: boolean;
    readonly conversations: boolean;
    readonly projects: boolean;
  };
  /**
   * Per source: its read gave up with nothing to show (#4093). Its rows are
   * missing, not absent — a view that lists them says so and offers
   * `retry`, never its empty state — and it is not loading, through a retry
   * either, so the notice holds until an answer replaces it.
   */
  readonly failed: {
    readonly chats: boolean;
    readonly tasks: boolean;
    readonly conversations: boolean;
  };
  /** A failed read is being asked for again. */
  readonly retrying: boolean;
  /** Asks again for each failed read not already being retried — never for
   * one that answered. */
  readonly retry: () => void;
  readonly hasInbox: boolean;
  /** Unread (or waiting-on-you) counts per kind — the switcher's dots;
   * `null` while that kind's read has failed, since its count is unknown. */
  readonly attention: {
    readonly chats: number | null;
    readonly tasks: number | null;
    readonly inbox: number | null;
  };
}

function isInboxStatus(value: unknown): value is InboxStatus {
  return (
    value === 'open' ||
    value === 'closed' ||
    value === 'spam' ||
    value === 'archived'
  );
}

type ConversationListRow = ReturnType<
  typeof useListConversationsPaginated
>['results'][number];

/** One inbox list row as a Home stream item — shared by the All view and
 * the panel's Inbox view, so a conversation reads the same in both. */
export function toHomeConversationItem(
  row: ConversationListRow,
  fallbackStatus: InboxStatus,
): HomeConversationItem | null {
  const id = typeof row.id === 'string' ? row.id : row._id;
  if (typeof id !== 'string') return null;
  const lastMessageAt =
    typeof row.last_message_at === 'string'
      ? Date.parse(row.last_message_at)
      : Number.NaN;
  const contact = row.contact;
  const contactLabel =
    contact !== undefined && contact !== null
      ? (contact.name ?? contact.email)
      : undefined;
  return {
    kind: 'conversation',
    id,
    title: row.title,
    activityAt: Number.isNaN(lastMessageAt) ? row._creationTime : lastMessageAt,
    unread: (row.unread_count ?? 0) > 0,
    status: isInboxStatus(row.status) ? row.status : fallbackStatus,
    ...(contactLabel !== undefined ? { contactLabel } : {}),
    ...(typeof row.lastMessagePreview === 'string'
      ? { preview: row.lastMessagePreview }
      : {}),
  };
}

/**
 * Everything the Home stream lists, from the three feature reads it is made
 * of. Each source keeps its own access rule and cache — the chat list is the
 * caller's own threads, the tasks are the open ones assigned to them across
 * every project they can read, and the inbox is the first page of OPEN
 * conversations their inbox scope shows. Always open, whichever status the
 * Inbox view was left on: that view reads its own pages, and the stream and
 * the Inbox dot are about what still needs an answer. A read that fails is
 * reported as `failed`, with a `retry` for it, never as an empty source.
 */
export function useHomeData(
  organizationId: string,
  options?: {
    includeArchivedChats?: boolean;
    taskStatuses?: TaskStatus[];
  },
): HomeData {
  const includeArchived = options?.includeArchivedChats === true;
  const threads = useChatThreads(organizationId);
  const archivedThreads = useArchivedThreads(organizationId, {
    enabled: includeArchived,
  });
  const retryChatLists = useChatThreadsRetry(organizationId);
  // A chat read that never answered starts over as `loading` when asked
  // again, so its failure is held here until that retry settles: the notice
  // keeps its busy Try again instead of giving way to the skeleton.
  const [chatRetryPending, setChatRetryPending] = useState(false);
  const projectsQuery = useChatProjects(organizationId);
  const { data: me } = useCurrentUser();
  const myUserId = me?.userId;

  const taskStatuses =
    options?.taskStatuses === undefined
      ? OPEN_TASK_STATUSES
      : options.taskStatuses.length > 0
        ? options.taskStatuses
        : undefined;

  // Two reads make "my tasks": the open work assigned to me, and the work
  // waiting on my review — whoever it is assigned to.
  const tasksQuery = useTasksAcrossProjects({
    assigneeId: myUserId,
    statuses: taskStatuses,
    enabled: myUserId !== undefined,
  });
  const reviewsQuery = useTasksAcrossProjects({
    reviewerId: myUserId,
    status: 'in_review',
    enabled: myUserId !== undefined,
  });

  const { showInbox: hasInbox, isLoading: inboxGateLoading } =
    useInboxAvailability(organizationId);
  const conversations = useListConversationsPaginated({
    organizationId,
    status: 'open',
    initialNumItems: INBOX_PAGE_SIZE,
    enabled: hasInbox,
  });

  const projects =
    projectsQuery.status === 'ready' ? projectsQuery.data : NO_PROJECTS;

  const projectKeys = useMemo(() => {
    const keys = new Map<string, string>();
    for (const project of projects) {
      if (project.key !== undefined) keys.set(project.id, project.key);
    }
    return keys;
  }, [projects]);

  const chatItems = useMemo((): HomeChatItem[] => {
    const list: ChatThreadSummary[] = [];
    if (threads.status === 'ready') {
      list.push(...threads.data);
    }
    if (
      includeArchived &&
      archivedThreads.status === 'ready' &&
      archivedThreads.data.rows
    ) {
      const existingIds = new Set(list.map((t) => t.id));
      for (const thread of archivedThreads.data.rows) {
        if (!existingIds.has(thread.id)) {
          list.push(thread);
        }
      }
    }
    return list.map((thread) => ({
      kind: 'chat',
      id: thread.id,
      title: thread.title ?? '',
      activityAt: thread.lastReplyAt ?? thread.updatedAt ?? thread.createdAt,
      unread:
        !thread.generating &&
        thread.lastReplyAt !== undefined &&
        thread.lastReplyAt > (thread.lastReadAt ?? 0),
      projectId: thread.projectId,
      pinnedAt: thread.pinnedAt,
      generating: thread.generating,
      shared: thread.isShared === true || thread.sharedWithProject === true,
      archived: thread.archived ?? false,
    }));
  }, [threads, archivedThreads, includeArchived]);

  const taskItems = useMemo((): HomeTaskItem[] => {
    const seen = new Set<string>();
    // The server's reviewer filter honors the captured review recipient.
    // A changed task default must not put an agent's review in a person's Home.
    const reviewTaskIds = new Set(reviewsQuery.tasks.map((task) => task._id));
    return [...tasksQuery.tasks, ...reviewsQuery.tasks]
      .filter((task) => {
        if (task.archivedAt !== undefined || seen.has(task._id)) return false;
        seen.add(task._id);
        return true;
      })
      .map((task) => {
        const key = task.projectKey ?? projectKeys.get(task.projectId);
        const identifier = formatTaskIdentifier(key, task.number);
        const awaitingMyReview =
          task.status === 'in_review' && reviewTaskIds.has(task._id);
        const item: HomeTaskItem = {
          kind: 'task',
          id: task._id,
          title: task.title,
          activityAt: task.updatedAt ?? task._creationTime,
          unread: awaitingMyReview,
          projectId: task.projectId,
          identifier: identifier ?? undefined,
          status: task.status,
          priority: task.priority ?? 'none',
          awaitingMyReview,
        };
        return item;
      });
  }, [tasksQuery.tasks, reviewsQuery.tasks, projectKeys]);

  const conversationItems = useMemo((): HomeConversationItem[] => {
    if (!hasInbox) return [];
    return conversations.results.flatMap((row) => {
      const item = toHomeConversationItem(row, 'open');
      return item === null ? [] : [item];
    });
  }, [conversations.results, hasInbox]);

  const items = useMemo(
    (): HomeItem[] => [...chatItems, ...taskItems, ...conversationItems],
    [chatItems, taskItems, conversationItems],
  );

  const threadsUnavailable = threads.status === 'unavailable';
  const archivedUnavailable =
    includeArchived && archivedThreads.status === 'unavailable';
  const chatsLoading =
    threads.status === 'loading' ||
    (includeArchived && archivedThreads.status === 'loading');
  const chatsRetrying = chatRetryPending && chatsLoading;
  const chatsFailed =
    threadsUnavailable || archivedUnavailable || chatsRetrying;
  // Either read failing leaves "my tasks" partial: what the other answered
  // stays listed, and the failure is still named.
  const tasksFailed =
    tasksQuery.read.kind === 'failed' || reviewsQuery.read.kind === 'failed';
  const conversationsFailed = hasInbox && conversations.unavailable;
  const retrying =
    chatsRetrying ||
    (tasksQuery.read.kind === 'failed' && tasksQuery.read.retrying) ||
    (reviewsQuery.read.kind === 'failed' && reviewsQuery.read.retrying) ||
    (conversationsFailed && conversations.isRetrying);

  const retry = () => {
    for (const query of [tasksQuery, reviewsQuery]) {
      if (query.read.kind === 'failed' && !query.read.retrying) query.retry();
    }
    if (conversationsFailed && !conversations.isRetrying) {
      conversations.retry();
    }
    if ((threadsUnavailable || archivedUnavailable) && !chatRetryPending) {
      setChatRetryPending(true);
      void retryChatLists({
        threads: threadsUnavailable,
        archived: archivedUnavailable,
      }).finally(() => setChatRetryPending(false));
    }
  };

  const attention = useMemo(
    () => ({
      chats: chatsFailed
        ? null
        : chatItems.filter((item) => item.unread).length,
      tasks: tasksFailed
        ? null
        : taskItems.filter((item) => item.awaitingMyReview).length,
      inbox: conversationsFailed
        ? null
        : conversationItems.filter((item) => item.unread).length,
    }),
    [
      chatItems,
      taskItems,
      conversationItems,
      chatsFailed,
      tasksFailed,
      conversationsFailed,
    ],
  );

  const threadsById = useMemo(() => {
    const map = new Map<string, ChatThreadSummary>();
    if (threads.status === 'ready') {
      for (const thread of threads.data) map.set(thread.id, thread);
    }
    if (
      includeArchived &&
      archivedThreads.status === 'ready' &&
      archivedThreads.data.rows
    ) {
      for (const thread of archivedThreads.data.rows) {
        if (!map.has(thread.id)) map.set(thread.id, thread);
      }
    }
    return map;
  }, [threads, archivedThreads, includeArchived]);

  return {
    items,
    threadsById,
    projects,
    loading: {
      chats: chatsLoading && !chatsFailed,
      tasks:
        myUserId === undefined ||
        (tasksQuery.isLoading && tasksQuery.read.kind !== 'failed') ||
        (reviewsQuery.isLoading && reviewsQuery.read.kind !== 'failed'),
      conversations:
        inboxGateLoading ||
        (hasInbox &&
          conversations.status === 'LoadingFirstPage' &&
          !conversations.unavailable),
      projects: projectsQuery.status === 'loading',
    },
    failed: {
      chats: chatsFailed,
      tasks: tasksFailed,
      conversations: conversationsFailed,
    },
    retrying,
    retry,
    hasInbox,
    attention,
  };
}
