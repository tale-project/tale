import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useHomeData } from './use-home-data';

const NOW = new Date(2026, 8, 23, 12, 0, 0).getTime();

const reads = vi.hoisted(() => ({
  conversations: vi.fn(),
  tasks: vi.fn(),
}));

vi.mock('@/app/features/chat/data/chat-backend', () => ({
  useChatThreads: () => ({
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
  }),
  useChatProjects: () => ({
    status: 'ready',
    data: [{ id: 'p1', name: 'Website relaunch', key: 'WEB' }],
  }),
}));

vi.mock('@/app/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { userId: 'me' } }),
}));

vi.mock('@/app/features/conversations/hooks/use-inbox-availability', () => ({
  useInboxAvailability: () => ({ hasInbox: true, isLoading: false }),
}));

vi.mock('@/app/features/conversations/hooks/queries', () => ({
  useListConversationsPaginated: reads.conversations,
}));

vi.mock('@/app/features/tasks/hooks/queries', () => ({
  useTasksAcrossProjects: reads.tasks,
}));

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
    loadMore: vi.fn(),
  });
  // The assigned read and the review read each answer the same task — it is
  // assigned to me AND names me as its reviewer.
  reads.tasks
    .mockReset()
    .mockImplementation(
      (options: { assigneeId?: string; reviewerId?: string }) => ({
        tasks:
          options.assigneeId === 'me' || options.reviewerId === 'me'
            ? [task({ assigneeId: 'me', reviewerUserId: 'me' })]
            : [],
        isLoading: false,
      }),
    );
});

describe('useHomeData', () => {
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
