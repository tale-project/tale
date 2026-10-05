import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ActorDirectoryProvider } from '../hooks/use-actor-directory';
import type { TaskDoc } from '../lib/display';
import { KanbanBoard } from './kanban-board';
import { TaskBoardProvider } from './task-board-context';
import type { TaskRow } from './task-card';

// Every read below runs through a real react-query observer, so the cases
// count what the mounted cards subscribe to. react-query adds and removes an
// observer in time linear in its query's observer count: a board whose cards
// each read the members, the automations and the project's agents turned a
// 2,000-card mount and unmount quadratic.
const READS: Record<string, unknown> = {
  'members/queries:listByOrganization': [
    {
      userId: 'user-1',
      displayName: 'Ava Editor',
      email: 'ava@example.com',
      role: 'admin',
    },
  ],
  'automations/queries:listAutomations': [],
  'projects/queries:listProjectAgents': [],
  'projects/queries:listAccessibleUserIds': { orgWide: true, userIds: [] },
  'projects/queries:getProject': { canEdit: true },
  'projects/queries:getStandardAgent': { available: false },
};
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string, args: unknown) =>
    useQuery({
      queryKey: ['read', name, args],
      queryFn: () => READS[name] ?? null,
      initialData: READS[name],
      enabled: args !== 'skip',
      staleTime: Number.POSITIVE_INFINITY,
    }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: (organizationId: string | undefined) =>
    useQuery({
      queryKey: ['member-context', organizationId],
      queryFn: () => ({ userId: 'user-1' }),
      initialData: { userId: 'user-1' },
      staleTime: Number.POSITIVE_INFINITY,
    }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
// The picker's candidate read, watched: it belongs to an open list only.
vi.mock('../hooks/use-actor-directory', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../hooks/use-actor-directory')>();
  return { ...actual, useAssignableActors: vi.fn(actual.useAssignableActors) };
});
vi.mock('../hooks/mutations', () => ({
  useMoveTask: () => ({ mutate: vi.fn(), isPending: false }),
  useAssignTask: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTask: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelTaskAgentRun: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/app/hooks/use-backend-client', () => ({
  useBackendClient: () => ({ query: vi.fn(async () => null) }),
}));
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../hooks/use-task-status-choreography', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../hooks/use-task-status-choreography')
  >()),
  useTaskStatusChoreography: () => async () => 'move' as const,
}));

const { useAssignableActors } = await import('../hooks/use-actor-directory');

function makeTasks(count: number): TaskRow[] {
  return Array.from({ length: count }, (_, index) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal fixture; the board renders these fields
    const task = {
      _id: `task-${index}`,
      _creationTime: 0,
      organizationId: 'org-1',
      projectId: 'project-1',
      title: `Card ${index}`,
      status: 'todo',
      rank: `a${String(index).padStart(4, '0')}`,
      number: index + 1,
      priority: 'p2',
      assigneeType: 'user',
      assigneeId: 'user-1',
      dueDate: index % 2 === 0 ? Date.UTC(2026, 9, 1) : undefined,
      commentCount: index % 3,
      createdBy: 'user-1',
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
    } as unknown as TaskDoc;
    return task;
  });
}

function renderBoard(client: QueryClient, tasks: TaskRow[]) {
  return render(
    <QueryClientProvider client={client}>
      <TaskBoardProvider tasks={tasks} dependencyEdges={[]}>
        <ActorDirectoryProvider organizationId="org-1" projectId="project-1">
          <KanbanBoard tasks={tasks} canWorkTask={() => true} />
        </ActorDirectoryProvider>
      </TaskBoardProvider>
    </QueryClientProvider>,
  );
}

function observerCount(client: QueryClient): number {
  return client
    .getQueryCache()
    .getAll()
    .reduce((sum, query) => sum + query.getObserversCount(), 0);
}

describe('board cards and the board directory', () => {
  it('adds no query observer per card, however many cards mount', () => {
    const client = new QueryClient();
    const few = renderBoard(client, makeTasks(5));
    expect(screen.getAllByRole('button', { name: /^Card \d+$/ })).toHaveLength(
      5,
    );
    const observersWithFew = observerCount(client);
    few.unmount();

    renderBoard(client, makeTasks(40));
    expect(screen.getAllByRole('button', { name: /^Card \d+$/ })).toHaveLength(
      40,
    );
    // The provider's own reads, and nothing per card.
    expect(observersWithFew).toBeGreaterThan(0);
    expect(observerCount(client)).toBe(observersWithFew);
  });

  it('names each assignee from the board directory and mounts no picker list until one is used', async () => {
    const client = new QueryClient();
    const { user } = renderBoard(client, makeTasks(3));
    expect(screen.getAllByRole('button', { name: 'Assign' })).toHaveLength(3);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(useAssignableActors).not.toHaveBeenCalled();

    const [firstAssign] = screen.getAllByRole('button', { name: 'Assign' });
    if (firstAssign === undefined) throw new Error('No assign button');
    expect(firstAssign).toHaveAttribute('aria-haspopup', 'dialog');
    expect(firstAssign).toHaveAttribute('aria-expanded', 'false');
    await user.click(firstAssign);
    // One click mounts the list already open, with its own reads.
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(useAssignableActors).toHaveBeenCalled();
    expect(
      screen.getByRole('option', { name: /Ava Editor/ }),
    ).toBeInTheDocument();
  });

  it('opens a card’s priority list on its first click', async () => {
    const client = new QueryClient();
    const { user } = renderBoard(client, makeTasks(2));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    const [firstPriority] = screen.getAllByRole('button', { name: 'Priority' });
    if (firstPriority === undefined) throw new Error('No priority button');
    await user.click(firstPriority);
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Urgent/ })).toBeInTheDocument();
  });
});
