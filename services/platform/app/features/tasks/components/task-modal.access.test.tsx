// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, render, screen } from '@/tests/utils/render';

import type { TaskDoc } from '../lib/display';
import { TaskModal } from './task-modal';

/**
 * The task sheet decides editability per task with the server's own rule
 * (`useTaskAccess` over `core/tasks/access.ts`): a project editor works every
 * task; a member works the tasks they created or are assigned to and reads
 * everyone else's; the label catalog stays with the project's editors.
 */

const state = vi.hoisted(() => ({
  task: null as Record<string, unknown> | null,
  access: { canEdit: false, canCreate: true },
  ancestors: [] as Record<string, unknown>[],
  projectCanEdit: false,
  isAdmin: false,
  ownedBy: null as Record<string, unknown> | null,
  candidateReads: 0,
  runs: [] as Record<string, unknown>[],
  update: vi.fn(async () => undefined),
}));

const baseTask = {
  _id: 'task-1',
  _creationTime: 0,
  organizationId: 'org-1',
  projectId: 'project-1',
  title: 'Summarize the supplier contracts',
  status: 'todo',
  rank: 'a0',
  number: 7,
  createdBy: 'u-editor',
  createdByType: 'user',
  createdAt: 0,
  updatedAt: 0,
} satisfies TaskDoc;

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string, args: unknown) => {
    const taskId =
      typeof args === 'object' && args !== null && 'taskId' in args
        ? args.taskId
        : undefined;
    if (name === 'tasks/queries:getTask' && taskId === baseTask._id) {
      return {
        data:
          state.task === null
            ? undefined
            : {
                task: state.task,
                ...state.access,
                canComment: true,
                ancestors: state.ancestors,
              },
        isLoading: false,
      };
    }
    if (name === 'projects/queries:getProject' && args !== 'skip') {
      return {
        data: {
          key: 'CON',
          name: 'Contracts',
          canEdit: state.projectCanEdit,
        },
        isLoading: false,
      };
    }
    if (name === 'tasks/queries:getTaskReviewer' && args !== 'skip') {
      return {
        data: {
          reviewer: { kind: 'inherit' },
          projectReviewer: { kind: 'human_default' },
          pendingReview: null,
        },
        isLoading: false,
      };
    }
    if (name === 'tasks/queries:listTaskAgentRuns' && args !== 'skip') {
      return { data: state.runs, isLoading: false };
    }
    return { data: undefined, isLoading: false };
  },
}));
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: () => ({ mutateAsync: state.update, isPending: false }),
}));
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/app/hooks/use-backend-client', () => ({
  useBackendClient: () => ({ query: vi.fn(async () => null) }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({
    data: { userId: 'u-member', isAdmin: state.isAdmin },
  }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  ...(await import('@/tests/utils/router-link-stub')).routerLinkStub,
  useNavigate: () => vi.fn(),
}));
vi.mock('../hooks/use-actor-directory', () => ({
  useProvidedActorDirectory: () => undefined,
  ActorDirectoryProvider: ({ children }: { children?: unknown }) => children,
  useActorDirectory: () => ({
    members: [],
    agents: [],
    resolveActor: () => ({ name: 'Teammate' }),
  }),
  useAssignableActors: () => {
    state.candidateReads += 1;
    return {
      subjectEntries: [],
      assignableMembers: [],
      assignableAgents: [],
      agents: [],
      resolveActor: () => ({ name: 'Teammate' }),
    };
  },
}));
vi.mock('@/app/features/shared/files/use-file-upload', () => ({
  useFileUpload: () => ({ attachments: [], uploadingFiles: [] }),
}));
vi.mock('./task-comments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./task-comments')>()),
  TaskCommentComposer: () => <div data-testid="task-comment-composer" />,
  TaskCommentComposerSkeleton: () => null,
}));
vi.mock('./task-conversation', () => ({
  TaskConversation: ({ taskId }: { taskId: string }) => (
    <div data-testid="task-conversation" data-task-id={taskId} />
  ),
}));
vi.mock('./task-attachments', () => ({ TaskAttachments: () => null }));
vi.mock('../hooks/use-task-subject-contract', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../hooks/use-task-subject-contract')
  >()),
  useTaskSubjectContract: () => state.ownedBy,
}));
vi.mock('./task-subject-panel', () => ({ TaskSubjectPanel: () => null }));
vi.mock('./task-automation-badge', () => ({ TaskAutomationBadge: () => null }));
vi.mock(
  '@/app/features/automations/components/automation-settings-dialog',
  () => ({ AutomationSettingsDialog: () => null }),
);
vi.mock('./task-dependencies', () => ({ TaskDependencies: () => null }));

function openTask(task: Record<string, unknown>) {
  state.task = task;
  const modal = (open: boolean) => (
    <TaskModal
      open={open}
      onOpenChange={vi.fn()}
      organizationId="org-1"
      projectId="project-1"
      taskId={baseTask._id}
    />
  );
  const rendered = render(modal(true));
  return {
    ...rendered,
    setOpen: (open: boolean) => rendered.rerender(modal(open)),
  };
}

function openCreate() {
  return render(
    <TaskModal
      open
      onOpenChange={vi.fn()}
      organizationId="org-1"
      projectId="project-1"
    />,
  );
}

beforeEach(() => {
  state.update.mockClear();
  state.task = null;
  state.access = { canEdit: false, canCreate: true };
  state.ancestors = [];
  state.projectCanEdit = false;
  state.isAdmin = false;
  state.ownedBy = null;
  state.candidateReads = 0;
  state.runs = [];
});

describe('TaskModal — inline title IME composition', () => {
  it.each(['Enter', 'blur'])(
    'cancels a dirty title before synchronous blur, then allows %s to save',
    async (commitWith) => {
      state.access = { canEdit: true, canCreate: true };
      openTask(baseTask);
      const field = await screen.findByRole('textbox', { name: 'Title' });
      field.focus();
      fireEvent.change(field, { target: { value: 'Do not save this title' } });
      // Native blur runs from the actual key handler before React applies its
      // queued draft reset. A separately fired blur would miss that race.
      fireEvent.keyDown(field, { key: 'Escape' });
      expect(state.update).not.toHaveBeenCalled();
      expect(field).toHaveValue(baseTask.title);
      expect(field).not.toHaveFocus();

      field.focus();
      fireEvent.change(field, { target: { value: 'A later edit' } });
      if (commitWith === 'Enter') fireEvent.keyDown(field, { key: 'Enter' });
      else field.blur();
      expect(state.update).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ title: 'A later edit' }),
      );
    },
  );

  it.each([false, true])(
    'accepts Enter after closing a composing title (mobile=%s)',
    async (mobile) => {
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = (query) => ({
        matches: mobile && query === '(max-width: 767px)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
      });
      try {
        state.access = { canEdit: true, canCreate: true };
        const { setOpen } = openTask(baseTask);
        const field = await screen.findByRole('textbox', { name: 'Title' });
        fireEvent.compositionStart(field);
        fireEvent.change(field, { target: { value: 'にほん' } });
        setOpen(false);
        if (mobile) expect(field).toBeInTheDocument();
        else expect(field).not.toBeInTheDocument();
        setOpen(true);
        const reopened = await screen.findByRole('textbox', { name: 'Title' });
        expect(state.update).not.toHaveBeenCalled();
        reopened.focus();
        fireEvent.change(reopened, { target: { value: '日本' } });
        fireEvent.keyDown(reopened, { key: 'Enter' });
        expect(state.update).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ title: '日本' }),
        );
      } finally {
        window.matchMedia = originalMatchMedia;
      }
    },
  );

  it.each(['mirror', 'native', 'Safari'])(
    'does not blur or save a composing title (%s)',
    async (signal) => {
      state.access = { canEdit: true, canCreate: true };
      openTask(baseTask);
      const field = await screen.findByRole('textbox', { name: 'Title' });
      field.focus();
      fireEvent.compositionStart(field);
      fireEvent.change(field, { target: { value: 'にほん' } });
      if (signal !== 'mirror') fireEvent.compositionEnd(field);
      const flags = {
        isComposing: signal === 'native',
        keyCode: signal === 'Safari' ? 229 : 13,
      };
      expect(fireEvent.keyDown(field, { key: 'Enter', ...flags })).toBe(true);
      fireEvent.keyDown(field, { key: 'Escape', ...flags });
      expect(field).toHaveFocus();
      expect(field).toHaveValue('にほん');
      expect(state.update).not.toHaveBeenCalled();
      fireEvent.compositionEnd(field);
      fireEvent.change(field, { target: { value: '日本' } });
      fireEvent.keyDown(field, { key: 'Enter' });
      expect(state.update).toHaveBeenCalledTimes(1);
      expect(state.update).toHaveBeenCalledWith(
        expect.objectContaining({ title: '日本' }),
      );
      expect(field).not.toHaveFocus();
    },
  );

  it.each([false, true])(
    'keeps ordinary Enter (shift=%s) committing once on blur',
    async (shiftKey) => {
      state.access = { canEdit: true, canCreate: true };
      openTask(baseTask);
      const field = await screen.findByRole('textbox', { name: 'Title' });
      field.focus();
      fireEvent.change(field, { target: { value: 'New title' } });
      fireEvent.keyDown(field, { key: 'Enter', shiftKey });
      expect(state.update).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ title: 'New title' }),
      );
    },
  );

  it('still saves a title when focus leaves during composition', async () => {
    state.access = { canEdit: true, canCreate: true };
    openTask(baseTask);
    const field = await screen.findByRole('textbox', { name: 'Title' });
    fireEvent.compositionStart(field);
    fireEvent.change(field, { target: { value: 'にほん' } });
    fireEvent.blur(field);
    expect(state.update).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: 'にほん' }),
    );
  });
});

describe('TaskModal — a member works their own task', () => {
  it.each([
    ['they created', { createdBy: 'u-member' }],
    ['assigned to them', { assigneeType: 'user', assigneeId: 'u-member' }],
  ])('edits a task %s', async (_how, owner) => {
    openTask({ ...baseTask, ...owner });

    expect(
      await screen.findByRole('textbox', { name: 'Title' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Status' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeEnabled();
    // Deleting stays with owners and admins; the label catalog with the
    // project's editors.
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Manage labels' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reviewer' })).toBeNull();
  });

  it('edits a subtask someone else added under their own task', async () => {
    state.ancestors = [
      { createdBy: 'u-member', createdByType: 'user', assigneeType: null },
    ];
    openTask({
      ...baseTask,
      parentTaskId: 'task-parent',
      createdBy: 'agent-1',
      createdByType: 'agent',
    });

    expect(
      await screen.findByRole('textbox', { name: 'Title' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Status' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Reviewer' })).toBeNull();
  });

  it("reads someone else's task without a control to change it", async () => {
    openTask(baseTask);

    // The title reads as a heading, not a field.
    expect(
      await screen.findAllByRole('heading', { name: baseTask.title }),
    ).not.toHaveLength(0);
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Status' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reviewer' })).toBeNull();
  });
});

describe('TaskModal — an editor, as before', () => {
  it("edits anyone's task and manages the project's labels", async () => {
    state.access = { canEdit: true, canCreate: true };
    state.projectCanEdit = true;
    openTask(baseTask);

    expect(
      await screen.findByRole('textbox', { name: 'Title' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Status' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reviewer' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Manage labels' }),
    ).toBeInTheDocument();
    // Opening the task names both pickers without their candidate reads.
    expect(state.candidateReads).toBe(0);
  });
});

describe('TaskModal — the discussion', () => {
  it('reads as the task page does: one conversation, the composer at its foot', async () => {
    state.access = { canEdit: true, canCreate: true };
    openTask(baseTask);

    const conversation = await screen.findByTestId('task-conversation');
    expect(conversation).toHaveAttribute('data-task-id', baseTask._id);
    const composer = screen.getByTestId('task-comment-composer');
    // The composer answers the thread from under it, as on the page.
    expect(
      conversation.compareDocumentPosition(composer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('TaskModal — what the agent cost', () => {
  const run = (runId: string, costCents: number) => ({
    runId,
    agentSlug: 'researcher',
    trigger: 'manual',
    status: 'completed',
    startedAt: 1,
    costCents,
  });

  it('sums the runs in the details, also once a person owns the task', async () => {
    state.runs = [run('run-1', 125), run('run-2', 250)];
    openTask({ ...baseTask, assigneeType: 'user', assigneeId: 'u-editor' });

    expect(await screen.findByText('Agent cost')).toBeInTheDocument();
    expect(screen.getByText('3.75 total')).toBeInTheDocument();
  });

  it('shows no such row while no run cost anything', async () => {
    state.runs = [run('run-1', 0)];
    state.access = { canEdit: true, canCreate: true };
    openTask(baseTask);

    await screen.findByRole('textbox', { name: 'Title' });
    expect(screen.queryByText('Agent cost')).not.toBeInTheDocument();
  });
});

describe('TaskModal — the create form', () => {
  it('lets a member create, without the label catalog’s controls', async () => {
    openCreate();

    expect(
      await screen.findByRole('textbox', { name: 'Title' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create task' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage labels' })).toBeNull();
  });

  it('offers an editor the label catalog’s controls', async () => {
    state.projectCanEdit = true;
    openCreate();

    expect(
      await screen.findByRole('button', { name: 'Manage labels' }),
    ).toBeInTheDocument();
  });
});

describe('TaskModal — the owning automation’s settings', () => {
  // Saving them writes the project's files, which the server keeps with the
  // project's editors — a member who works the task is not offered the door.
  const automationOwned = {
    automationSlug: 'document-verify-desk',
    displayName: 'Document verification desk',
    contract: { workflow: 'document-verify-desk', input: { kind: 'folder' } },
    settings: {
      forms: [
        { file: 'settings.yml', fields: [{ key: 'region', type: 'text' }] },
      ],
    },
  };
  const settingsButton = {
    name: 'Document verification desk — settings',
  };

  it('are not offered to a member working their own task', async () => {
    state.ownedBy = automationOwned;
    openTask({ ...baseTask, createdBy: 'u-member' });

    expect(
      await screen.findByRole('textbox', { name: 'Title' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', settingsButton)).toBeNull();
  });

  it('open from the task for a project editor', async () => {
    state.ownedBy = automationOwned;
    state.access = { canEdit: true, canCreate: true };
    state.projectCanEdit = true;
    openTask(baseTask);

    expect(
      await screen.findByRole('button', settingsButton),
    ).toBeInTheDocument();
  });
});
