import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { AppError } from '@/lib/shared/errors/app-error';
import { cleanup, render, screen, within } from '@/tests/utils/render';

import { KanbanBoard } from './kanban-board';
import type { TaskRow } from './task-card';

import '@/app/globals.css';

// The drop's write runs through the real `useMoveTask` and
// `useBackendMutation`; only its door and the toast sink are stubbed, with
// the reads the cards would make.
const mocks = vi.hoisted(() => ({
  move: vi.fn(),
  toast: vi.fn(),
  choreograph: vi.fn(async (): Promise<'move' | 'blocked'> => 'move'),
}));
vi.mock('@/app/lib/backend/adapters', async (original) => ({
  ...(await original<typeof import('@/app/lib/backend/adapters')>()),
  WRITE_ADAPTERS: { 'tasks/mutations:moveTask': { run: mocks.move } },
  activeOrganizationId: () => 'org-test',
}));
vi.mock('@tale/ui/use-toast', async (original) => ({
  ...(await original<typeof import('@tale/ui/use-toast')>()),
  toast: mocks.toast,
}));
vi.mock('../hooks/use-next-task-toast', () => ({
  useNextTaskToast: () => vi.fn(),
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/app/hooks/use-backend-client', () => ({
  useBackendClient: () => ({ query: vi.fn(async () => null) }),
}));
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../hooks/use-actor-directory', () => ({
  useProvidedActorDirectory: () => undefined,
  ActorDirectoryProvider: ({ children }: { children?: unknown }) => children,
  useActorDirectory: () => ({
    members: [],
    agents: [],
    currentUserId: null,
    resolveActor: () => null,
  }),
  useAssignableActors: () => ({
    assignableAgents: [],
    agents: [],
    currentUserId: null,
    resolveActor: () => null,
  }),
}));
vi.mock('../hooks/use-task-status-choreography', () => ({
  plannedTransitionKind: () => 'move',
  useTaskStatusChoreography: () => mocks.choreograph,
}));
vi.mock('../hooks/use-task-subject-contract', () => ({
  resolveTaskOwnership: () => ({ kind: 'human' }),
  taskSubjectEntries: () => [],
  resolveTaskSubjectContract: () => null,
  useTaskSubjectContract: () => null,
  useTaskContractAutomations: () => [],
}));

function makeTask(
  id: string,
  title: string,
  status: TaskRow['status'],
  rank: string,
  number: number,
): TaskRow {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- component fixture: unused backend fields are omitted
  return {
    _id: id,
    _creationTime: 0,
    organizationId: 'org-test',
    projectId: 'project-1',
    title,
    status,
    rank,
    number,
    projectKey: 'TAL',
    createdBy: 'user-1',
    createdByType: 'user',
    createdAt: 0,
    updatedAt: 0,
  } as TaskRow;
}

const TASKS = [
  makeTask('task-parent', 'Ship the release', 'in_progress', 'a0', 1),
  makeTask('task-notes', 'Write the release notes', 'done', 'a1', 2),
];

function Board() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <div className="h-[600px] w-full">
        <KanbanBoard tasks={TASKS} canWorkTask={() => true} />
      </div>
    </QueryClientProvider>
  );
}

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const cardIn = (lane: string) =>
  within(screen.getByRole('region', { name: lane })).queryByRole('button', {
    name: 'Ship the release',
  });

const OPEN_SUBTASKS = new AppError({
  code: 'TASK_HAS_OPEN_SUBTASKS',
  message: 'Open subtasks remain',
});

/** Pick the In progress card up from the keyboard and drop it on Done. */
async function dropOnDone() {
  await page.viewport(1920, 900);
  render(<Board />);
  screen.getByRole('button', { name: 'Ship the release' }).focus();
  await userEvent.keyboard(' ');
  await nextFrame();
  await userEvent.keyboard('{ArrowRight}');
  await nextFrame();
  await userEvent.keyboard('{ArrowRight}');
  await nextFrame();
  await userEvent.keyboard(' ');
}

const focusedIn = (lane: string) => document.activeElement === cardIn(lane);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('a refused board drop (real Chromium)', () => {
  it('puts the card back in its column, focus included, and names the open subtasks', async () => {
    mocks.move.mockRejectedValueOnce(OPEN_SUBTASKS);
    await dropOnDone();

    await expect.poll(() => mocks.toast.mock.calls.length).toBe(1);
    expect(mocks.move).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-parent', status: 'done' }),
      { organizationId: 'org-test' },
    );
    await expect.poll(() => cardIn('In progress')).not.toBeNull();
    expect(cardIn('Done')).toBeNull();
    // Going back remounts the title in its own lane; the keyboard focus the
    // drop left on it goes along.
    await expect.poll(() => focusedIn('In progress')).toBe(true);
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Couldn't finish that action",
      description: 'Finish all subtasks before closing this task.',
      variant: 'destructive',
    });
  });

  it('gives the focus back when the refusal lands after the drop placed it', async () => {
    const refused = Promise.withResolvers<unknown>();
    mocks.move.mockReturnValueOnce(refused.promise);
    await dropOnDone();
    // dnd-kit has put the focus on the title in Done by now.
    await expect.poll(() => focusedIn('Done')).toBe(true);

    refused.reject(OPEN_SUBTASKS);
    await expect.poll(() => cardIn('In progress')).not.toBeNull();
    await expect.poll(() => focusedIn('In progress')).toBe(true);
  });

  it('gives the focus back when a choreography blocks the drop', async () => {
    const blocked = Promise.withResolvers<'move' | 'blocked'>();
    mocks.choreograph.mockReturnValueOnce(blocked.promise);
    await dropOnDone();
    await expect.poll(() => focusedIn('Done')).toBe(true);

    blocked.resolve('blocked');
    await expect.poll(() => cardIn('In progress')).not.toBeNull();
    await expect.poll(() => focusedIn('In progress')).toBe(true);
    expect(mocks.move).not.toHaveBeenCalled();
  });
});
