import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskActivityRow } from '../utils/task-timeline';
import { TaskConversation } from './task-conversation';

const DAY = 24 * 60 * 60 * 1000;
const NOON = new Date(2026, 8, 23, 12, 0, 0).getTime();

const data: {
  comments: Array<{
    messageId: string;
    authorType: 'user' | 'agent';
    authorId: string;
    body: string;
    createdAt: number;
  }>;
  hasEarlier: boolean;
  activity: TaskActivityRow[];
} = { comments: [], hasEarlier: false, activity: [] };

vi.mock('../hooks/queries', () => ({
  // The discussion arrives newest first, like the backend's page walk.
  useTaskDiscussion: () => ({
    comments: data.comments,
    hasEarlier: data.hasEarlier,
    isLoadingEarlier: false,
    loadEarlier: vi.fn(),
  }),
  useTaskActivity: () => ({ activity: data.activity }),
  useTaskAgentRuns: () => ({ runs: [] }),
}));

vi.mock('../hooks/mutations', () => ({
  useAddTaskComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useEditTaskComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteTaskComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    resolveActor: (type: string, id: string) => ({
      type,
      id,
      name: id === 'u1' ? 'Ada' : id,
      isAgent: type === 'agent',
    }),
    resolveAssigneeId: (id: string) => id,
    resolveActorPreview: () => null,
    resolveAgentRunPreview: () => null,
    resolveWorkflowRunPreview: () => null,
  }),
}));

vi.mock('./mention-text', () => ({
  MentionText: ({ body }: { body: string }) => <p>{body}</p>,
}));

vi.mock('@tale/ui/use-format-date', () => ({
  useFormatDate: () => ({
    formatRelative: () => 'just now',
    formatDate: () => 'Sep 23, 2026',
    formatDateHeader: (date: Date) =>
      date.getDate() === 23 ? 'Today' : 'Yesterday',
  }),
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => ({ locale: 'en' }),
}));

function activity(
  id: string,
  action: string,
  createdAt: number,
  toValue?: string,
): TaskActivityRow {
  return {
    _id: id,
    actorType: 'user',
    actorId: 'u1',
    action,
    createdAt,
    ...(toValue !== undefined ? { toValue } : {}),
  };
}

beforeEach(() => {
  data.comments = [];
  data.hasEarlier = false;
  data.activity = [];
});

function renderConversation() {
  return render(
    <TaskConversation
      taskId="task-1"
      organizationId="org-1"
      projectId="project-1"
      canComment
      currentUserId="u1"
    />,
  );
}

describe('TaskConversation', () => {
  it('reads oldest first, with what happened between the comments', () => {
    data.comments = [
      {
        messageId: 'm2',
        authorType: 'user',
        authorId: 'u1',
        body: 'Second thought',
        createdAt: NOON - 1000,
      },
      {
        messageId: 'm1',
        authorType: 'user',
        authorId: 'u1',
        body: 'First thought',
        createdAt: NOON - 3000,
      },
    ];
    data.activity = [
      activity('a1', 'status.changed', NOON - 2000, 'in_review'),
    ];
    renderConversation();

    const text = screen.getByRole('region').textContent ?? '';
    expect(text.indexOf('First thought')).toBeLessThan(
      text.indexOf('status.in_review'),
    );
    expect(text.indexOf('status.in_review')).toBeLessThan(
      text.indexOf('Second thought'),
    );
  });

  it('does not repeat a comment as a "comment added" event', () => {
    data.comments = [
      {
        messageId: 'm1',
        authorType: 'user',
        authorId: 'u1',
        body: 'Looks good',
        createdAt: NOON,
      },
    ];
    data.activity = [activity('a1', 'comment.added', NOON)];
    renderConversation();
    expect(screen.queryByText(/activity\.commentAdded/)).toBeNull();
    expect(screen.getByText('Looks good')).toBeInTheDocument();
  });

  it('opens each day under its own date pill', () => {
    data.comments = [
      {
        messageId: 'm2',
        authorType: 'user',
        authorId: 'u1',
        body: 'New note',
        createdAt: NOON,
      },
      {
        messageId: 'm1',
        authorType: 'user',
        authorId: 'u1',
        body: 'Old note',
        createdAt: NOON - DAY,
      },
    ];
    renderConversation();
    const text = screen.getByRole('region').textContent ?? '';
    // Yesterday's pill, its note, then today's pill and its note.
    expect(text.indexOf('Yesterday')).toBeLessThan(text.indexOf('Old note'));
    expect(text.indexOf('Old note')).toBeLessThan(text.indexOf('Today'));
    expect(text.indexOf('Today')).toBeLessThan(text.indexOf('New note'));
  });

  it('holds back events older than the loaded comments while earlier pages remain', () => {
    data.hasEarlier = true;
    data.comments = [
      {
        messageId: 'm1',
        authorType: 'user',
        authorId: 'u1',
        body: 'Latest loaded',
        createdAt: NOON,
      },
    ];
    data.activity = [
      activity('old', 'status.changed', NOON - 5000, 'todo'),
      activity('new', 'status.changed', NOON + 1000, 'done'),
    ];
    renderConversation();
    expect(screen.queryByText(/status\.todo/)).toBeNull();
    expect(screen.getByText(/status\.done/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'detail.showEarlierComments' }),
    ).toBeInTheDocument();
  });

  it('invites the first comment on an empty thread', () => {
    renderConversation();
    expect(screen.getByText('detail.conversationEmpty')).toBeInTheDocument();
  });
});
