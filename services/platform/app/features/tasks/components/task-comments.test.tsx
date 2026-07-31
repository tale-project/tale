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

vi.mock('./mention-textarea', () => ({
  MentionTextarea: (props: {
    value: string;
    placeholder?: string;
    'aria-describedby'?: string;
  }) => (
    <textarea
      placeholder={props.placeholder}
      value={props.value}
      aria-describedby={props['aria-describedby']}
      readOnly
    />
  ),
}));

vi.mock('./mention-trigger-chips', () => ({
  MentionTriggerChips: () => null,
}));

vi.mock('../hooks/queries', () => ({
  useTaskDiscussion: () => ({
    comments: [
      {
        messageId: 'msg_1',
        authorType: 'agent',
        authorId: 'assistant',
        body: '[automated] Verification complete',
        bodyByLocale: {
          en: '[automated] Verification complete',
          de: '[automated] Prüfung abgeschlossen',
          fr: '[automated] Vérification terminée',
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
            viewTo: '/dashboard/$id',
            viewParams: { id: 'org_1' },
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
      screen.getByText('[automated] Prüfung abgeschlossen'),
    ).toBeInTheDocument();
    expect(screen.queryByText('[automated] Verification complete')).toBeNull();
  });
});

describe('TaskComments order', () => {
  // The fixture timeline is ascending: msg_1 (automated) then msg_2 (user).
  const listedBodies = () =>
    screen
      .getAllByRole('listitem')
      .map((li) => li.textContent ?? '')
      .filter(
        (text) => text.includes('[automated]') || text.includes('Thanks.'),
      );

  // Newest first by DEFAULT: a task's discussion is mostly automated reports,
  // so the latest one carries the state — and the Activity list right below it
  // has always read newest-first.
  it('puts the newest comment first by default', () => {
    localeState.locale = 'en';
    render(
      <TaskComments
        taskId={'task_1' as never}
        organizationId="org_1"
        projectId={'project_1' as never}
        canComment={false}
      />,
    );
    const bodies = listedBodies();
    expect(bodies[0]).toContain('Thanks.');
    expect(bodies[1]).toContain('[automated] Verification complete');
  });

  it('reads as a conversation (oldest first) with order="asc"', () => {
    localeState.locale = 'en';
    render(
      <TaskComments
        taskId={'task_1' as never}
        organizationId="org_1"
        projectId={'project_1' as never}
        canComment={false}
        order="asc"
      />,
    );
    const bodies = listedBodies();
    expect(bodies[0]).toContain('[automated] Verification complete');
    expect(bodies[1]).toContain('Thanks.');
  });
});

describe('TaskComments composer position', () => {
  // The composer sits at the newest end: below an ascending conversation,
  // above a newest-first log.
  const composerVsList = (container: HTMLElement) => {
    const composer = container.querySelector('textarea');
    const firstItem = container.querySelector('ul li');
    if (!composer || !firstItem) return 'missing';
    const pos = composer.compareDocumentPosition(firstItem);
    // DOCUMENT_POSITION_FOLLOWING (4): the list comes AFTER the composer.
    return pos & Node.DOCUMENT_POSITION_FOLLOWING
      ? 'composer-first'
      : 'list-first';
  };

  it('renders above the thread by default (desc)', () => {
    localeState.locale = 'en';
    const { container } = render(
      <TaskComments
        taskId={'task_1' as never}
        organizationId="org_1"
        projectId={'project_1' as never}
        canComment
      />,
    );
    expect(composerVsList(container)).toBe('composer-first');
  });

  it('renders below the thread with order="asc"', () => {
    localeState.locale = 'en';
    const { container } = render(
      <TaskComments
        taskId={'task_1' as never}
        organizationId="org_1"
        projectId={'project_1' as never}
        canComment
        order="asc"
      />,
    );
    expect(composerVsList(container)).toBe('list-first');
  });
});

describe('TaskComments composer hint', () => {
  it('renders the hint and wires it as the textarea description', () => {
    localeState.locale = 'en';
    const { container } = render(
      <TaskComments
        taskId={'task_1' as never}
        organizationId="org_1"
        projectId={'project_1' as never}
        canComment
        composerHint="A run is in progress."
      />,
    );
    expect(screen.getByText('A run is in progress.')).toHaveAttribute(
      'id',
      'new-comment-hint',
    );
    expect(container.querySelector('textarea')).toHaveAttribute(
      'aria-describedby',
      'new-comment-hint',
    );
  });

  it('omits the hint and the aria wiring when not provided', () => {
    localeState.locale = 'en';
    const { container } = render(
      <TaskComments
        taskId={'task_1' as never}
        organizationId="org_1"
        projectId={'project_1' as never}
        canComment
      />,
    );
    expect(container.querySelector('#new-comment-hint')).toBeNull();
    expect(container.querySelector('textarea')).not.toHaveAttribute(
      'aria-describedby',
    );
  });
});
