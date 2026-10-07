import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectConversationItem } from '@/lib/shared/conversations/conversation-item';

import { useHomeData } from './use-home-data';

const NOW = new Date(2026, 8, 23, 12, 0, 0).getTime();

const reads = vi.hoisted(() => ({
  conversations: vi.fn(),
  tasks: vi.fn(),
  archived: vi.fn(),
  threads: vi.fn(),
  projects: vi.fn(),
  retryChats: vi.fn(),
  inboxAvailability: { hasInbox: true, showInbox: true, isLoading: false },
}));

const CHATS = {
  status: 'ready',
  data: [
    {
      id: 'chat-unread',
      title: 'A reply waits',
      kind: 'direct',
      archived: false,
      generating: false,
      createdAt: NOW - 3000,
      updatedAt: NOW - 2000,
      lastReplyAt: NOW - 1000,
      lastReadAt: NOW - 2000,
    },
    {
      id: 'chat-read',
      title: 'All caught up',
      kind: 'direct',
      archived: false,
      generating: false,
      createdAt: NOW - 3000,
      updatedAt: NOW - 2000,
      lastReplyAt: NOW - 2000,
      lastReadAt: NOW - 1000,
    },
  ],
};

vi.mock('@/app/features/chat/data/chat-backend', () => ({
  useArchivedThreads: reads.archived,
  useChatThreads: reads.threads,
  useChatThreadsRetry: () => reads.retryChats,
  useChatProjects: reads.projects,
}));

vi.mock('@/app/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { userId: 'me' } }),
}));

vi.mock('@/app/features/conversations/hooks/use-inbox-availability', () => ({
  useInboxAvailability: () => reads.inboxAvailability,
}));

vi.mock('@/app/features/conversations/hooks/queries', () => ({
  useListConversationsPaginated: reads.conversations,
}));

vi.mock('@/app/features/tasks/hooks/queries', () => ({
  useTasksAcrossProjects: reads.tasks,
}));

/** One task read as `useTasksAcrossProjects` answers it. */
function taskRead(tasks: unknown[], read: unknown = { kind: 'ready' }) {
  return { tasks, isLoading: false, read, retry: vi.fn() };
}

/** The shapes each read takes once its retries gave up (#4093). */
const failedTaskRead = () => taskRead([], { kind: 'failed', retrying: false });
const failedInboxRead = () => ({
  results: [],
  status: 'Exhausted',
  isLoading: false,
  loadMore: vi.fn(),
  error: new Error('Request failed with status 503'),
  retry: vi.fn(),
  isRetrying: false,
  unavailable: true,
  errorCount: 1,
});

function kinds(items: readonly { kind: string }[]) {
  return items.map((item) => item.kind);
}

function task(overrides: Record<string, unknown>) {
  return {
    _id: 't1',
    _creationTime: NOW - 5000,
    projectId: 'p1',
    number: 2,
    title: 'Review the launch checklist',
    status: 'in_review',
    updatedAt: NOW - 4000,
    ...overrides,
  };
}

beforeEach(() => {
  reads.inboxAvailability.hasInbox = true;
  reads.inboxAvailability.showInbox = true;
  reads.threads.mockReset().mockReturnValue(CHATS);
  reads.projects.mockReset().mockReturnValue({
    status: 'ready',
    data: [{ id: 'p1', name: 'Website relaunch', key: 'WEB' }],
  });
  reads.retryChats.mockReset().mockResolvedValue(undefined);
  reads.archived.mockReset().mockReturnValue({
    status: 'ready',
    data: { rows: [], nextCursor: null },
  });
  reads.conversations.mockReset().mockReturnValue({
    results: [
      {
        _id: 'c1',
        _creationTime: NOW - 9000,
        title: 'Invoice shows the wrong VAT rate',
        status: 'open',
        unread_count: 2,
        last_message_at: new Date(NOW - 500).toISOString(),
        contact: { name: 'Anna Meier', email: 'anna@example.com' },
        lastMessagePreview: 'Can you correct it?',
      },
    ],
    status: 'Exhausted',
    isLoading: false,
    loadMore: vi.fn(),
    error: null,
    retry: vi.fn(),
    isRetrying: false,
    unavailable: false,
    errorCount: 0,
  });
  // The assigned read and the review read each answer the same task — it is
  // assigned to me AND names me as its reviewer.
  reads.tasks
    .mockReset()
    .mockImplementation(
      (options: { assigneeId?: string; reviewerId?: string }) =>
        taskRead(
          options.assigneeId === 'me' || options.reviewerId === 'me'
            ? [task({ assigneeId: 'me', reviewerUserId: 'me' })]
            : [],
        ),
    );
});

describe('useHomeData', () => {
  it('retains chat rows and their lookup when only read envelopes change', () => {
    const archived = [{ ...CHATS.data[0], id: 'archived', archived: true }];
    reads.threads.mockImplementation(() => ({ ...CHATS }));
    reads.archived.mockImplementation(() => ({
      status: 'ready',
      data: { rows: archived, nextCursor: null },
    }));
    const { result, rerender } = renderHook(() =>
      useHomeData('org-1', { includeArchivedChats: true }),
    );
    const chats = result.current.items.filter((item) => item.kind === 'chat');
    const lookup = result.current.threadsById;
    rerender();
    const next = result.current.items.filter((item) => item.kind === 'chat');
    expect(next).toHaveLength(3);
    for (const [index, chat] of chats.entries()) expect(next[index]).toBe(chat);
    expect(result.current.threadsById).toBe(lookup);

    reads.threads.mockReturnValue({
      ...CHATS,
      data: CHATS.data.map((chat) => ({ ...chat, title: 'Updated title' })),
    });
    rerender();
    expect(result.current.threadsById).not.toBe(lookup);
    expect(result.current.threadsById.get('chat-unread')?.title).toBe(
      'Updated title',
    );
  });

  it('retains Home projections when only the query wrappers change', () => {
    const projectData = [{ id: 'p1', name: 'Website relaunch', key: 'WEB' }];
    const assigned = [task({ assigneeId: 'me', reviewerUserId: 'me' })];
    const noRows: unknown[] = [];
    reads.projects.mockImplementation(() => ({
      status: 'ready',
      data: projectData,
    }));
    reads.threads.mockImplementation(() => ({ ...CHATS }));
    reads.tasks.mockImplementation(() => taskRead(assigned));
    reads.conversations.mockImplementation(() => ({
      results: noRows,
      status: 'Exhausted',
      unavailable: false,
    }));

    const { result, rerender } = renderHook(() => useHomeData('org-1'));
    const previous = result.current;
    rerender();

    expect(result.current.items).toBe(previous.items);
    expect(result.current.threadsById).toBe(previous.threadsById);
    expect(result.current.attention).toBe(previous.attention);

    reads.threads.mockReturnValue({
      ...CHATS,
      data: [...CHATS.data, { ...CHATS.data[0], id: 'chat-new' }],
    });
    rerender();
    expect(result.current.items).not.toBe(previous.items);
    expect(result.current.threadsById.has('chat-new')).toBe(true);
  });

  it('keeps the Inbox navigation visible while source discovery has failed', () => {
    reads.inboxAvailability.hasInbox = false;
    reads.inboxAvailability.showInbox = true;
    const { result } = renderHook(() => useHomeData('org-1'));
    expect(result.current.hasInbox).toBe(true);
    expect(reads.conversations).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  it('hides the Inbox navigation only after successful empty discovery', () => {
    reads.inboxAvailability.hasInbox = false;
    reads.inboxAvailability.showInbox = false;
    const { result } = renderHook(() => useHomeData('org-1'));
    expect(result.current.hasInbox).toBe(false);
    expect(reads.conversations).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it('uses the captured server review recipient instead of a stale task designation', () => {
    reads.tasks.mockImplementation(
      (options: { assigneeId?: string; reviewerId?: string }) =>
        taskRead(
          options.reviewerId === 'me'
            ? [task({ _id: 'captured-me', reviewerUserId: undefined })]
            : [
                task({
                  _id: 'captured-agent',
                  assigneeId: 'me',
                  reviewerUserId: 'me',
                }),
              ],
        ),
    );
    const { result } = renderHook(() => useHomeData('org-1'));
    expect(
      result.current.items.find((item) => item.id === 'captured-me'),
    ).toMatchObject({ awaitingMyReview: true, unread: true });
    expect(
      result.current.items.find((item) => item.id === 'captured-agent'),
    ).toMatchObject({ awaitingMyReview: false, unread: false });
  });

  it('reads archived rows only when requested and keeps live summaries on duplicate ids', () => {
    const archived = {
      id: 'archived-chat',
      title: 'Old conversation',
      kind: 'direct',
      archived: true,
      generating: false,
      createdAt: NOW - 5000,
      updatedAt: NOW - 4000,
    };
    reads.archived.mockReturnValue({
      status: 'ready',
      data: {
        rows: [archived, { ...archived, id: 'chat-read' }],
        nextCursor: null,
      },
    });
    const { result, rerender } = renderHook(
      ({ includeArchivedChats }) =>
        useHomeData('org-1', { includeArchivedChats }),
      { initialProps: { includeArchivedChats: false } },
    );
    expect(reads.archived).toHaveBeenLastCalledWith('org-1', {
      enabled: false,
    });
    expect(result.current.threadsById.has('archived-chat')).toBe(false);
    rerender({ includeArchivedChats: true });
    expect(reads.archived).toHaveBeenLastCalledWith('org-1', { enabled: true });
    expect(
      result.current.items.filter((item) => item.kind === 'chat'),
    ).toHaveLength(3);
    expect(result.current.threadsById.get('archived-chat')).toEqual(archived);
    expect(result.current.threadsById.get('chat-read')?.archived).toBe(false);
  });

  it('keeps chats loading while an enabled archive read is pending', () => {
    reads.archived.mockReturnValue({ status: 'loading' });
    const { result } = renderHook(() =>
      useHomeData('org-1', { includeArchivedChats: true }),
    );
    expect(result.current.loading.chats).toBe(true);
  });

  it('reads every task status when the status facet has no selection', () => {
    renderHook(() => useHomeData('org-1', { taskStatuses: [] }));
    expect(reads.tasks).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: 'me',
        statuses: undefined,
      }),
    );
  });

  it('keeps literal text in the server-cleaned inbox preview', () => {
    const html =
      '<p>Your code is &lt;123456&gt;; type &amp;amp; literally.</p>';
    const row = projectConversationItem({
      conversation: {
        id: 'c1',
        organizationId: 'org-1',
        channel: 'email',
        status: 'open',
        createdAt: NOW,
      },
      contact: null,
      messages: [
        {
          id: 'm1',
          direction: 'inbound',
          content: html,
          metadata: { html },
          createdAt: NOW,
        },
      ],
    });
    reads.conversations.mockReturnValue({
      results: [row],
      status: 'Exhausted',
      loadMore: vi.fn(),
    });

    const { result } = renderHook(() => useHomeData('org-1'));

    expect(
      result.current.items.find((item) => item.kind === 'conversation'),
    ).toMatchObject({
      preview: 'Your code is <123456>; type &amp; literally.',
    });
  });

  it('reads the open conversations for the stream, whatever the Inbox view shows', () => {
    const { result } = renderHook(() => useHomeData('org-1'));

    expect(reads.conversations).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        status: 'open',
        enabled: true,
      }),
    );
    const conversation = result.current.items.find(
      (item) => item.kind === 'conversation',
    );
    expect(conversation).toMatchObject({
      id: 'c1',
      status: 'open',
      unread: true,
      contactLabel: 'Anna Meier',
      preview: 'Can you correct it?',
    });
  });

  it('lists a task once when it is both assigned to me and waiting on my review', () => {
    const { result } = renderHook(() => useHomeData('org-1'));

    const tasks = result.current.items.filter((item) => item.kind === 'task');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: 't1',
      identifier: 'WEB-2',
      awaitingMyReview: true,
      unread: true,
    });
  });

  it('counts what needs you for the switcher dots', () => {
    const { result } = renderHook(() => useHomeData('org-1'));

    expect(result.current.attention).toEqual({
      chats: 1,
      tasks: 1,
      inbox: 1,
    });
  });
});

/**
 * A read that gave up is unknown, never "none" (#4093): its rows are missing
 * from the stream, so the stream says which kind did not load and asks for
 * exactly the reads that failed again — never an empty view or a zero count.
 */
describe('useHomeData when a read fails', () => {
  it('names a failed inbox read instead of listing no conversations', () => {
    const inbox = failedInboxRead();
    reads.conversations.mockReturnValue(inbox);
    const { result } = renderHook(() => useHomeData('org-1'));

    expect(kinds(result.current.items)).toEqual(['chat', 'chat', 'task']);
    expect(result.current.failed).toEqual({
      chats: false,
      tasks: false,
      conversations: true,
    });
    expect(result.current.loading.conversations).toBe(false);
    expect(result.current.attention).toEqual({
      chats: 1,
      tasks: 1,
      inbox: null,
    });

    act(() => result.current.retry());
    expect(inbox.retry).toHaveBeenCalledTimes(1);
    expect(reads.retryChats).not.toHaveBeenCalled();
  });

  it('names a failed task read, keeps what the other read answered, and asks again for the failed one alone', () => {
    const assigned = failedTaskRead();
    const reviews = taskRead([task({ _id: 't9', reviewerUserId: 'me' })]);
    reads.tasks.mockImplementation((options: { reviewerId?: string }) =>
      options.reviewerId === undefined ? assigned : reviews,
    );
    const { result } = renderHook(() => useHomeData('org-1'));

    expect(kinds(result.current.items)).toEqual([
      'chat',
      'chat',
      'task',
      'conversation',
    ]);
    expect(result.current.failed).toEqual({
      chats: false,
      tasks: true,
      conversations: false,
    });
    expect(result.current.loading.tasks).toBe(false);
    // My tasks are only partly known: no count claims what waits on me.
    expect(result.current.attention.tasks).toBeNull();

    act(() => result.current.retry());
    expect(assigned.retry).toHaveBeenCalledTimes(1);
    expect(reviews.retry).not.toHaveBeenCalled();
  });

  it('holds a failed task read through its retry instead of loading it afresh', () => {
    const assigned = {
      ...failedTaskRead(),
      // react-query restarts a read that never answered as a first load.
      isLoading: true,
      read: { kind: 'failed', retrying: true },
    };
    reads.tasks.mockImplementation((options: { reviewerId?: string }) =>
      options.reviewerId === undefined ? assigned : taskRead([]),
    );
    const { result } = renderHook(() => useHomeData('org-1'));

    expect(result.current.failed.tasks).toBe(true);
    expect(result.current.loading.tasks).toBe(false);
    expect(result.current.retrying).toBe(true);
    // A retry already under way is not asked for twice.
    act(() => result.current.retry());
    expect(assigned.retry).not.toHaveBeenCalled();
  });

  it('names an unavailable chat read, and holds it until its retry settles', async () => {
    reads.threads.mockReturnValue({ status: 'unavailable' });
    let settle = () => {};
    reads.retryChats.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );
    const { result, rerender } = renderHook(() => useHomeData('org-1'));

    expect(kinds(result.current.items)).toEqual(['task', 'conversation']);
    expect(result.current.failed).toEqual({
      chats: true,
      tasks: false,
      conversations: false,
    });
    expect(result.current.loading.chats).toBe(false);
    expect(result.current.attention.chats).toBeNull();

    act(() => result.current.retry());
    expect(reads.retryChats).toHaveBeenCalledWith({
      threads: true,
      archived: false,
    });

    // The seam answers `loading` while the read is asked for again; the
    // failure stands until that retry settles.
    reads.threads.mockReturnValue({ status: 'loading' });
    rerender();
    expect(result.current.failed.chats).toBe(true);
    expect(result.current.loading.chats).toBe(false);
    expect(result.current.retrying).toBe(true);
    act(() => result.current.retry());
    expect(reads.retryChats).toHaveBeenCalledTimes(1);

    reads.threads.mockReturnValue(CHATS);
    await act(async () => settle());
    expect(result.current.failed.chats).toBe(false);
    expect(result.current.retrying).toBe(false);
    expect(kinds(result.current.items)).toEqual([
      'chat',
      'chat',
      'task',
      'conversation',
    ]);
  });

  it('counts a failed archive read as a chat failure while archived chats are shown', () => {
    reads.archived.mockReturnValue({ status: 'unavailable' });
    const { result } = renderHook(() =>
      useHomeData('org-1', { includeArchivedChats: true }),
    );

    expect(result.current.failed.chats).toBe(true);
    expect(result.current.loading.chats).toBe(false);
    act(() => result.current.retry());
    expect(reads.retryChats).toHaveBeenCalledWith({
      threads: false,
      archived: true,
    });
  });

  it('reads nothing as empty or zero when every read failed', () => {
    const inbox = failedInboxRead();
    const assigned = failedTaskRead();
    const reviews = failedTaskRead();
    reads.threads.mockReturnValue({ status: 'unavailable' });
    reads.conversations.mockReturnValue(inbox);
    reads.tasks.mockImplementation((options: { reviewerId?: string }) =>
      options.reviewerId === undefined ? assigned : reviews,
    );
    const { result } = renderHook(() => useHomeData('org-1'));

    expect(result.current.items).toEqual([]);
    expect(result.current.failed).toEqual({
      chats: true,
      tasks: true,
      conversations: true,
    });
    expect(result.current.loading).toMatchObject({
      chats: false,
      tasks: false,
      conversations: false,
    });
    expect(result.current.attention).toEqual({
      chats: null,
      tasks: null,
      inbox: null,
    });
    expect(result.current.retrying).toBe(false);

    act(() => result.current.retry());
    expect(reads.retryChats).toHaveBeenCalledTimes(1);
    expect(assigned.retry).toHaveBeenCalledTimes(1);
    expect(reviews.retry).toHaveBeenCalledTimes(1);
    expect(inbox.retry).toHaveBeenCalledTimes(1);
  });
});
