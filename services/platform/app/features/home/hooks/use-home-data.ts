'use client';

import { formatTaskIdentifier } from '@tale/shared/utils/project-key';
import { useMemo } from 'react';

import {
  useChatProjects,
  useChatThreads,
} from '@/app/features/chat/data/chat-backend';
import type {
  ChatProjectSummary,
  ChatThreadSummary,
} from '@/app/features/chat/types';
import { useListConversationsPaginated } from '@/app/features/conversations/hooks/queries';
import { useInboxAvailability } from '@/app/features/conversations/hooks/use-inbox-availability';
import { cleanMessagePreview } from '@/app/features/conversations/lib/message-preview';
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
  readonly hasInbox: boolean;
  /** Unread (or waiting-on-you) counts per kind — the switcher's dots. */
  readonly attention: {
    readonly chats: number;
    readonly tasks: number;
    readonly inbox: number;
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
      ? { preview: cleanMessagePreview(row.lastMessagePreview) }
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
 * the Inbox dot are about what still needs an answer.
 */
export function useHomeData(organizationId: string): HomeData {
  const threads = useChatThreads(organizationId);
  const projectsQuery = useChatProjects(organizationId);
  const { data: me } = useCurrentUser();
  const myUserId = me?.userId;

  // Two reads make "my tasks": the open work assigned to me, and the work
  // waiting on my review — whoever it is assigned to.
  const tasksQuery = useTasksAcrossProjects({
    assigneeId: myUserId,
    statuses: OPEN_TASK_STATUSES,
    enabled: myUserId !== undefined,
  });
  const reviewsQuery = useTasksAcrossProjects({
    reviewerId: myUserId,
    status: 'in_review',
    enabled: myUserId !== undefined,
  });

  const { hasInbox, isLoading: inboxGateLoading } =
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
    if (threads.status !== 'ready') return [];
    return threads.data.map((thread) => ({
      kind: 'chat',
      id: thread.id,
      title: thread.title ?? '',
      activityAt: thread.lastReplyAt ?? thread.updatedAt ?? thread.createdAt,
      unread:
        !thread.generating &&
        thread.lastReplyAt !== undefined &&
        thread.lastReplyAt > (thread.lastReadAt ?? 0),
      ...(thread.projectId !== undefined
        ? { projectId: thread.projectId }
        : {}),
      ...(thread.pinnedAt !== undefined ? { pinnedAt: thread.pinnedAt } : {}),
      generating: thread.generating,
      shared: thread.isShared === true || thread.sharedWithProject === true,
    }));
  }, [threads]);

  const taskItems = useMemo((): HomeTaskItem[] => {
    const seen = new Set<string>();
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
          task.status === 'in_review' && task.reviewerUserId === myUserId;
        const item: HomeTaskItem = {
          kind: 'task',
          id: task._id,
          title: task.title,
          activityAt: task.updatedAt ?? task._creationTime,
          unread: awaitingMyReview,
          projectId: task.projectId,
          identifier: identifier ?? undefined,
          status: task.status,
          awaitingMyReview,
        };
        return item;
      });
  }, [tasksQuery.tasks, reviewsQuery.tasks, projectKeys, myUserId]);

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

  const attention = useMemo(
    () => ({
      chats: chatItems.filter((item) => item.unread).length,
      tasks: taskItems.filter((item) => item.awaitingMyReview).length,
      inbox: conversationItems.filter((item) => item.unread).length,
    }),
    [chatItems, taskItems, conversationItems],
  );

  const threadsById = useMemo(() => {
    const map = new Map<string, ChatThreadSummary>();
    if (threads.status === 'ready') {
      for (const thread of threads.data) map.set(thread.id, thread);
    }
    return map;
  }, [threads]);

  return {
    items,
    threadsById,
    projects,
    loading: {
      chats: threads.status === 'loading',
      tasks:
        myUserId === undefined ||
        tasksQuery.isLoading ||
        reviewsQuery.isLoading,
      conversations:
        inboxGateLoading ||
        (hasInbox && conversations.status === 'LoadingFirstPage'),
      projects: projectsQuery.status === 'loading',
    },
    hasInbox,
    attention,
  };
}
