// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { TaskDoc } from '../lib/display';
import { TaskModal } from './task-modal';

/**
 * The task modal keeps its Assign picker while the parent link opens the
 * parent task (#3915). A handoff asked for the subtask must not open its
 * confirm over the parent, nor cancel or reassign the parent.
 */

const state = vi.hoisted(() => ({
  writes: [] as { name: string; args: unknown }[],
  held: new Map<string, { answered: Promise<void>; release: () => void }>(),
}));

function makeTask(id: string, number: number, parentTaskId?: string) {
  return {
    _id: id,
    _creationTime: 0,
    organizationId: 'org-1',
    projectId: 'project-1',
    title: `Task number ${number}`,
    status: 'todo',
    rank: 'a0',
    number,
    createdBy: 'u-editor',
    createdByType: 'user',
    createdAt: 0,
    updatedAt: 0,
    assigneeType: 'app',
    assigneeId: 'invoice-flow',
    ...(parentTaskId ? { parentTaskId } : {}),
  } satisfies TaskDoc;
}

const tasks: Record<string, TaskDoc> = {
  'task-a': makeTask('task-a', 1, 'task-b'),
  'task-b': makeTask('task-b', 2),
};

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string, args: unknown) => {
    const taskId =
      typeof args === 'object' && args !== null && 'taskId' in args
        ? String(args.taskId)
        : undefined;
    if (name === 'tasks/queries:getTask' && taskId && tasks[taskId]) {
      return {
        data: {
          task: tasks[taskId],
          canEdit: true,
          canCreate: true,
          canComment: true,
          ancestors: [],
        },
        isLoading: false,
      };
    }
    if (name === 'projects/queries:getProject' && args !== 'skip') {
      return {
        data: { key: 'TEST', name: 'Test', canEdit: true },
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
    return { data: undefined, isLoading: false };
  },
}));
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: (name: string) => ({
    mutate: (args: unknown) => state.writes.push({ name, args }),
    mutateAsync: async (args: unknown) => {
      state.writes.push({ name, args });
    },
    isPending: false,
  }),
}));
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: (name: string) => ({
    mutateAsync: async (args: unknown) => {
      state.writes.push({ name, args });
    },
    isPending: false,
  }),
}));
// Both tasks are held by a live automation run; a task's live-run reads
// answer when the test releases them.
vi.mock('@/app/hooks/use-backend-client', () => ({
  useBackendClient: () => ({
    query: async (name: string, args: { taskId: string }) => {
      await state.held.get(args.taskId)?.answered;
      return name === 'automations/queries:getLiveRunForTask'
        ? { _id: `run-${args.taskId}` }
        : null;
    },
  }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({
    data: { userId: 'u-editor', isAdmin: false },
  }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  ...(await import('@/tests/utils/router-link-stub')).routerLinkStub,
  useNavigate: () => vi.fn(),
}));
vi.mock('../hooks/use-actor-directory', () => {
  const resolveActor = (type: string, id: string) => ({
    type,
    id,
    name: id === 'user-1' ? 'Alex' : 'Invoice flow',
  });
  return {
    useProvidedActorDirectory: () => undefined,
    ActorDirectoryProvider: ({ children }: { children?: unknown }) => children,
    useActorDirectory: () => ({
      members: [],
      agents: [],
      currentUserId: 'u-editor',
      resolveActor,
    }),
    useAssignableActors: () => ({
      assignableMembers: [
        { type: 'user', id: 'user-1', name: 'Alex', email: 'alex@example.com' },
      ],
      assignableAgents: [],
      agentsLoading: false,
      currentUserId: 'u-editor',
      resolveActor,
      canAddAgents: false,
      projectResolved: true,
      standardAgentAvailable: false,
    }),
  };
});
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
vi.mock('../hooks/use-task-subject-contract', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../hooks/use-task-subject-contract')
  >()),
  useTaskSubjectContract: () => null,
  useTaskContractAutomations: () => [],
}));
vi.mock('./task-subject-panel', () => ({ TaskSubjectPanel: () => null }));
vi.mock('./task-automation-badge', () => ({ TaskAutomationBadge: () => null }));
vi.mock(
  '@/app/features/automations/components/automation-settings-dialog',
  () => ({ AutomationSettingsDialog: () => null }),
);
vi.mock('./task-dependencies', () => ({ TaskDependencies: () => null }));

function hold(taskId: string) {
  let release = () => {};
  const answered = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.held.set(taskId, { answered, release });
}

/** The board's sheet: the parent link opens the parent in the same modal. */
function Sheet() {
  const [taskId, setTaskId] = useState('task-a');
  return (
    <TaskModal
      open
      onOpenChange={vi.fn()}
      organizationId="org-1"
      projectId="project-1"
      taskId={taskId}
      onOpenTask={setTaskId}
    />
  );
}

async function pickAlex(user: ReturnType<typeof render>['user']) {
  await user.click(screen.getByRole('button', { name: 'Assign' }));
  await user.click(await screen.findByRole('option', { name: /Alex/ }));
}

describe('TaskModal assignee handoff across the parent link (#3915)', () => {
  beforeEach(() => {
    state.writes = [];
    state.held = new Map();
  });

  it('cancels the open task’s own run and reassigns it once confirmed', async () => {
    const { user } = render(<Sheet />);

    await pickAlex(user);
    await user.click(await screen.findByRole('button', { name: 'Reassign' }));

    await vi.waitFor(() =>
      expect(state.writes).toEqual([
        {
          name: 'tasks/public_actions:cancelTaskWorkflow',
          args: { organizationId: 'org-1', taskId: 'task-a' },
        },
        {
          name: 'tasks/mutations:assignTask',
          args: {
            taskId: 'task-a',
            assigneeType: 'user',
            assigneeId: 'user-1',
          },
        },
      ]),
    );
  });

  it('opens no confirm over the parent and writes nothing when the subtask’s read answers late', async () => {
    hold('task-a');
    const { user } = render(<Sheet />);

    await pickAlex(user);
    await user.click(screen.getByRole('button', { name: 'Part of TEST-2' }));
    expect(
      await screen.findByRole('heading', { name: 'Task number 2' }),
    ).toBeInTheDocument();
    await act(async () => {
      state.held.get('task-a')?.release();
    });

    expect(screen.queryByText('Reassign this task?')).not.toBeInTheDocument();
    expect(state.writes).toEqual([]);
  });
});
