// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

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
  projectCanEdit: false,
  isAdmin: false,
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
            : { task: state.task, ...state.access, canComment: true },
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
    return { data: undefined, isLoading: false };
  },
}));
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  useNavigate: () => vi.fn(),
}));
vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    members: [],
    agents: [],
    resolveActor: () => ({ name: 'Teammate' }),
  }),
  useAssignableActors: () => ({
    assignableMembers: [],
    assignableAgents: [],
    agents: [],
    resolveActor: () => ({ name: 'Teammate' }),
  }),
}));
vi.mock('@/app/features/shared/files/use-file-upload', () => ({
  useFileUpload: () => ({ attachments: [], uploadingFiles: [] }),
}));
vi.mock('./task-comments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./task-comments')>()),
  TaskComments: () => null,
  TaskCommentComposer: () => null,
  TaskCommentComposerSkeleton: () => null,
}));
vi.mock('./task-timeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./task-timeline')>()),
  TaskTimeline: () => null,
}));
vi.mock('./task-attachments', () => ({ TaskAttachments: () => null }));
vi.mock('./task-dependencies', () => ({ TaskDependencies: () => null }));

function openTask(task: Record<string, unknown>) {
  state.task = task;
  return render(
    <TaskModal
      open
      onOpenChange={vi.fn()}
      organizationId="org-1"
      projectId="project-1"
      taskId={baseTask._id}
    />,
  );
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
  state.task = null;
  state.access = { canEdit: false, canCreate: true };
  state.projectCanEdit = false;
  state.isAdmin = false;
});

describe('TaskModal — a member works their own task', () => {
  it.each([
    ['created', { createdBy: 'u-member' }],
    ['is assigned to', { assigneeType: 'user', assigneeId: 'u-member' }],
  ])('edits a task they %s', async (_how, owner) => {
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
    expect(
      screen.getByRole('button', { name: 'Manage labels' }),
    ).toBeInTheDocument();
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
