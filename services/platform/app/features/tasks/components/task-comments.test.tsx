import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TaskComments } from './task-comments';

const localeState = { locale: 'en' };

vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => localeState,
}));

vi.mock('./mention-text', () => ({
  MentionText: ({ body }: { body: string }) => <p>{body}</p>,
}));

vi.mock('../hooks/queries', () => ({
  useTaskDiscussion: () => ({
    comments: [
      {
        messageId: 'msg_1',
        authorType: 'agent',
        authorId: 'assistant',
        body: '[automated] Return prepared',
        bodyByLocale: {
          en: '[automated] Return prepared',
          de: '[automated] Abrechnung vorbereitet',
          fr: '[automated] Décompte préparé',
        },
        createdAt: Date.now(),
      },
      {
        messageId: 'msg_2',
        authorType: 'user',
        authorId: 'user_1',
        body: 'Thanks.',
        createdAt: Date.now(),
      },
    ],
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useAddTaskComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEditTaskComment: () => ({ mutateAsync: vi.fn() }),
  useDeleteTaskComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    resolveActor: (type: string, id: string) => ({
      type,
      id,
      name: type === 'agent' ? 'Assistant' : 'Israel',
      isAgent: type === 'agent',
    }),
    resolveActorPreview: (type: string, id: string) =>
      type === 'agent' && id === 'assistant'
        ? {
            kind: 'agent',
            name: 'Assistant',
            description: 'General-purpose helper',
            viewTo: '/dashboard/$id/agents/$agentId',
            viewParams: { id: 'org_1', agentId: 'assistant' },
          }
        : null,
  }),
}));

vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({
    formatRelative: () => 'just now',
    formatDate: () => 'Jan 1, 2026',
  }),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => key,
  }),
}));

describe('TaskComments author previews', () => {
  it('shows a preview trigger for agent comment authors', () => {
    localeState.locale = 'en';
    render(
      <TaskComments
        taskId={'task_1' as never}
        organizationId="org_1"
        projectId={'project_1' as never}
        canComment={false}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Assistant' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Israel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Israel' })).toBeNull();
  });
});

describe('TaskComments bodyByLocale', () => {
  it('renders the body for the active UI locale', () => {
    localeState.locale = 'de';
    render(
      <TaskComments
        taskId={'task_1' as never}
        organizationId="org_1"
        projectId={'project_1' as never}
        canComment={false}
      />,
    );

    expect(
      screen.getByText('[automated] Abrechnung vorbereitet'),
    ).toBeInTheDocument();
    expect(screen.queryByText('[automated] Return prepared')).toBeNull();
  });
});
