import { TooltipProvider } from '@tale/ui/tooltip';
import {
  act,
  fireEvent,
  render as renderWithoutShell,
  screen,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { taskCommentDraftKey } from '../lib/draft-key';
import { TaskCommentComposer, TaskComments } from './task-comments';

/** The app shell provides tooltips; a comment's icon actions carry one. */
const render: typeof renderWithoutShell = (ui, options) =>
  renderWithoutShell(ui, { wrapper: TooltipProvider, ...options });

const localeState = { locale: 'en' };

const mutationState = vi.hoisted(() => ({
  addPending: false,
  addMutateAsync: vi.fn(),
  editRead: vi.fn(),
}));

vi.mock('@/app/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { userId: 'u1' } }),
}));

vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => localeState,
}));

vi.mock('./mention-text', () => ({
  MentionText: ({ body }: { body: string }) => <p>{body}</p>,
}));

vi.mock('../lib/mention-actor-options', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/mention-actor-options')>()),
  useMentionActorOptions: () => [],
}));

vi.mock('./mention-trigger-chips', () => ({
  MentionTriggerChips: () => null,
}));

const discussionState = vi.hoisted(() => ({
  hasEarlier: false,
  isLoadingEarlier: false,
  loadEarlier: vi.fn(),
}));

vi.mock('../hooks/queries', () => ({
  // The hook answers NEWEST first (the page walk starts at the tail):
  // msg_2 (user, newer) then msg_1 (automated, older).
  useTaskDiscussion: () => ({
    comments: [
      {
        messageId: 'msg_2',
        authorType: 'user',
        authorId: 'user_1',
        body: 'Thanks.',
        createdAt: Date.now(),
      },
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
    ],
    isLoading: false,
    hasEarlier: discussionState.hasEarlier,
    isLoadingEarlier: discussionState.isLoadingEarlier,
    loadEarlier: discussionState.loadEarlier,
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useAddTaskComment: () => {
    const [isPending, setIsPending] = useState(false);
    return {
      mutateAsync: async (args: { taskId: string; body: string }) => {
        setIsPending(true);
        try {
          return await mutationState.addMutateAsync(args);
        } finally {
          setIsPending(false);
        }
      },
      isPending: mutationState.addPending || isPending,
    };
  },
  useEditTaskComment: () => {
    mutationState.editRead();
    return { mutateAsync: vi.fn(), isPending: false };
  },
  useDeleteTaskComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/use-actor-directory', () => ({
  useProvidedActorDirectory: () => undefined,
  ActorDirectoryProvider: ({ children }: { children?: unknown }) => children,
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
            agent: {
              name: 'Assistant',
              organizationId: 'org_1',
              projectId: 'project_1',
              harness: 'codex',
              model: 'gpt-6.1',
              modelProvider: 'openai',
              skills: [],
              connectors: [],
              tools: [],
              instructions: 'General-purpose helper',
              managed: false,
            },
            viewTo: '/dashboard/$id',
            viewParams: { id: 'org_1' },
          }
        : null,
  }),
}));

vi.mock('@tale/ui/use-format-date', () => ({
  useFormatDate: () => ({
    formatRelative: () => 'just now',
    formatDate: () => 'Jan 1, 2026',
  }),
}));

vi.mock('@tale/ui/i18n/client', () => ({
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

describe('TaskComments — who may change a comment', () => {
  const thread = (props: {
    currentUserId: string;
    canWork: boolean;
    isAdmin?: boolean;
  }) =>
    render(
      <TaskComments
        taskId={'task_1' as never}
        organizationId="org_1"
        projectId={'project_1' as never}
        canComment
        {...props}
      />,
    );

  it('creates no edit mutation observers until an author opens an editor', () => {
    mutationState.editRead.mockClear();
    localeState.locale = 'en';
    thread({ currentUserId: 'user_1', canWork: false });
    expect(mutationState.editRead).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'actions.edit' }));
    expect(mutationState.editRead).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue('Thanks.')).toBeInTheDocument();
  });

  it('lets an author edit and delete their own comment on a task they may not work', () => {
    localeState.locale = 'en';
    thread({ currentUserId: 'user_1', canWork: false });
    expect(
      screen.getByRole('button', { name: 'actions.edit' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'actions.delete' }),
    ).toBeInTheDocument();
  });

  it("offers a member nothing on someone else's comment", () => {
    localeState.locale = 'en';
    thread({ currentUserId: 'user_2', canWork: false });
    expect(screen.queryByRole('button', { name: 'actions.edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'actions.delete' })).toBeNull();
  });

  it("lets an admin delete someone else's comment, never edit it", () => {
    localeState.locale = 'en';
    thread({ currentUserId: 'user_2', canWork: true, isAdmin: true });
    expect(
      screen.getAllByRole('button', { name: 'actions.delete' }),
    ).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'actions.edit' })).toBeNull();
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
  // The fixture arrives newest-first: msg_2 (user) then msg_1 (automated).
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

describe('TaskComments earlier pages', () => {
  // Regression: the feed used to be a fixed oldest-200 read, so a busy
  // task's newest comments never rendered. The walk into older pages must be
  // offered whenever the backend says more exist, at the OLDEST end.
  it('offers to load earlier comments below a newest-first log', async () => {
    localeState.locale = 'en';
    discussionState.hasEarlier = true;
    discussionState.loadEarlier.mockClear();
    const { container } = render(
      <TaskComments
        taskId={'task_1' as never}
        organizationId="org_1"
        projectId={'project_1' as never}
        canComment={false}
      />,
    );
    const button = screen.getByRole('button', {
      name: 'detail.showEarlierComments',
    });
    const list = container.querySelector('ul');
    expect(list).not.toBeNull();
    // The list comes BEFORE the control: older pages append at the bottom.
    expect(
      list!.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    button.click();
    expect(discussionState.loadEarlier).toHaveBeenCalledTimes(1);
    discussionState.hasEarlier = false;
  });

  it('shows no such control once the start of the discussion is loaded', () => {
    localeState.locale = 'en';
    discussionState.hasEarlier = false;
    render(
      <TaskComments
        taskId={'task_1' as never}
        organizationId="org_1"
        projectId={'project_1' as never}
        canComment={false}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'detail.showEarlierComments' }),
    ).toBeNull();
  });

  it('shows the task-wide count in the heading when it is known', () => {
    localeState.locale = 'en';
    render(
      <TaskComments
        taskId={'task_1' as never}
        organizationId="org_1"
        projectId={'project_1' as never}
        canComment={false}
        commentCount={412}
      />,
    );
    expect(screen.getByRole('heading', { level: 3 }).textContent).toContain(
      '(412)',
    );
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

describe('TaskComments submit loading', () => {
  it('disables the comment button while a new comment is posting', () => {
    mutationState.addPending = true;
    localeState.locale = 'en';
    render(
      <TaskComments
        taskId={'task_1' as never}
        organizationId="org_1"
        projectId={'project_1' as never}
        canComment
      />,
    );

    expect(
      screen.getByRole('button', { name: 'actions.comment' }),
    ).toBeDisabled();
    mutationState.addPending = false;
  });
});

describe('TaskCommentComposer draft', () => {
  afterEach(() => {
    window.localStorage.clear();
    mutationState.addMutateAsync.mockReset();
    vi.restoreAllMocks();
  });

  describe.each(['inline', 'chat'] as const)('%s submission', (variant) => {
    const composer = () => (
      <TaskCommentComposer
        taskId="task-1"
        organizationId="org-1"
        projectId="project-1"
        variant={variant}
      />
    );
    const key = taskCommentDraftKey('u1', 'org-1', 'task-1');

    it.each([
      ['Later unsent comment', true],
      ['  First submitted comment  ', true],
      ['First submitted comment', false],
    ])('retains only a newer draft: %s', async (laterDraft, edited) => {
      let finish!: (result: { unresolvedMentionTokens: string[] }) => void;
      mutationState.addMutateAsync.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const view = render(composer());
      const field = screen.getByRole('textbox');
      fireEvent.change(field, { target: { value: 'First submitted comment' } });
      fireEvent.click(screen.getByRole('button', { name: 'actions.comment' }));
      expect(mutationState.addMutateAsync).toHaveBeenCalledExactlyOnceWith({
        taskId: 'task-1',
        body: 'First submitted comment',
      });
      expect(
        screen.getByRole('button', { name: 'actions.comment' }),
      ).toBeDisabled();
      expect(field).not.toBeDisabled();
      expect(field).not.toHaveAttribute('readonly');
      if (edited) fireEvent.change(field, { target: { value: laterDraft } });
      await act(async () => {
        finish({ unresolvedMentionTokens: [] });
      });
      expect(field).toHaveValue(edited ? laterDraft : '');
      expect(window.localStorage.getItem(key)).toBe(
        edited ? JSON.stringify(laterDraft) : null,
      );
      view.unmount();
      render(composer());
      expect(screen.getByRole('textbox')).toHaveValue(edited ? laterDraft : '');
    });

    it.each([false, true])(
      'retains a failed draft (edited: %s)',
      async (edited) => {
        let fail!: (error: Error) => void;
        mutationState.addMutateAsync.mockReturnValue(
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
        );
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(composer());
        const field = screen.getByRole('textbox');
        fireEvent.change(field, {
          target: { value: 'First submitted comment' },
        });
        fireEvent.click(
          screen.getByRole('button', { name: 'actions.comment' }),
        );
        const retainedDraft = edited
          ? 'Later unsent comment'
          : 'First submitted comment';
        if (edited)
          fireEvent.change(field, { target: { value: retainedDraft } });
        await act(async () => {
          fail(new Error('Comment failed'));
        });
        expect(field).toHaveValue(retainedDraft);
        expect(window.localStorage.getItem(key)).toBe(
          JSON.stringify(retainedDraft),
        );
        expect(
          screen.getByRole('button', { name: 'actions.comment' }),
        ).toBeEnabled();
      },
    );
  });

  it.each(['Half a thought', '<Button />', '<tag>'])(
    'brings back the unsent comment %s of its own task',
    (text) => {
      window.localStorage.setItem(
        taskCommentDraftKey('u1', 'org-1', 'task-1'),
        JSON.stringify(text),
      );
      render(
        <TaskCommentComposer
          taskId="task-1"
          organizationId="org-1"
          projectId="project-1"
        />,
      );
      expect(screen.getByRole('textbox')).toHaveValue(text);
      expect(
        window.localStorage.getItem(
          taskCommentDraftKey('u1', 'org-1', 'task-1'),
        ),
      ).toBe(JSON.stringify(text));
    },
  );

  it('starts empty on a task with nothing unsent', () => {
    window.localStorage.setItem(
      taskCommentDraftKey('u1', 'org-1', 'task-1'),
      JSON.stringify('Half a thought'),
    );
    render(
      <TaskCommentComposer
        taskId="task-2"
        organizationId="org-1"
        projectId="project-1"
      />,
    );
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
});
