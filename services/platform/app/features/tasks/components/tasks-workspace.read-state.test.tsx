// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  configure,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

import { TasksWorkspace } from './tasks-workspace';

// A board of 27 cards re-renders on every keystroke, and a failed read
// settles after four attempts: give each wait room on a busy runner.
configure({ asyncUtilTimeout: 10_000 });

/**
 * The Tasks page over its real read hooks and task adapters, against a
 * stubbed backend that answers the board's doors the way the server does.
 *
 * #3745: the search is a board filter. The page used to intersect its board
 * read with the palette's search, whose first 25 hits ignore the facets, so
 * a task the facets kept could fall outside them and the lanes read empty.
 *
 * #3747: a failed read is an unknown result. It used to settle on six
 * "No tasks" lanes, or leave every row under a search that never answered,
 * with nothing to retry.
 */

const ORG = 'org-1';
const PROJECT = 'project-1';
const ME = 'u-me';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/hooks/use-session-user', () => ({
  useSessionUser: () => ({ isLoading: false, isAuthenticated: true }),
}));
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProject: () => ({
    project: { key: 'WEB', canEdit: true },
    isLoading: false,
  }),
}));
vi.mock('./task-modal', () => ({ TaskModal: () => null }));
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
vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    members: [],
    agents: [],
    currentUserId: 'u-me',
    resolveActor: () => null,
  }),
  useAssignableActors: () => ({
    assignableMembers: [],
    assignableAgents: [],
    agents: [],
    currentUserId: 'u-me',
    resolveActor: () => null,
  }),
}));
vi.mock('../hooks/use-task-status-choreography', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../hooks/use-task-status-choreography')
  >()),
  useTaskStatusChoreography: () => async () => 'move' as const,
}));
vi.mock('../hooks/use-task-subject-contract', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../hooks/use-task-subject-contract')
  >()),
  useTaskSubjectContract: () => null,
  useTaskContractAutomations: () => [],
}));

interface FakeTask {
  id: string;
  title: string;
  status: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done';
  priority: 'p0' | 'p1' | 'p2' | 'p3' | null;
  assigneeId: string | null;
  reviewerUserId?: string;
}

/** A backend task row the way the board doors answer it. */
function wireTask(task: FakeTask) {
  return {
    id: task.id,
    organizationId: ORG,
    projectId: PROJECT,
    title: task.title,
    description: null,
    attachments: null,
    outputs: null,
    number: Number(task.id.replace(/\D/g, '')) || 1,
    status: task.status,
    priority: task.priority,
    labelIds: [],
    labels: [],
    assigneeType: task.assigneeId === null ? null : 'user',
    assigneeId: task.assigneeId,
    reviewerUserId: task.reviewerUserId ?? null,
    parentTaskId: null,
    commentCount: 0,
    rank: `a${task.id}`,
    externalSystem: null,
    externalId: null,
    externalUrl: null,
    threadId: null,
    discussionThreadId: null,
    sourceDiscussionThreadId: null,
    startDate: null,
    startNotifiedAt: null,
    dueDate: null,
    repeat: null,
    repeatNextTaskId: null,
    repeatContinued: false,
    slaLevel: null,
    slaLevelAt: null,
    statusChangedAt: null,
    totalCostCents: null,
    agentRunCount: 0,
    lastAgentRunAt: null,
    claimedAt: null,
    completedAt: null,
    createdBy: ME,
    createdByType: 'user',
    createdAt: 1000,
    updatedAt: 2000,
    archivedAt: null,
    folderExists: true,
    hasFiles: false,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type ReadMode = 'ok' | 'fail' | 'hang';

/**
 * The board, dependency and activity doors over one set of tasks. The board
 * door filters like the server: every token of `q` in the title, and the
 * assignee — the page no longer narrows a capped search, so what this door
 * answers is what the lanes must show.
 */
function fakeBoardBackend(tasks: FakeTask[]) {
  const control = {
    board: 'ok' as ReadMode,
    /** Fail only the reads that carry a search. */
    searchedBoard: 'ok' as ReadMode,
    dependencies: 'ok' as ReadMode,
    activity: 'ok' as ReadMode,
    truncated: false,
    canEdit: true,
    edges: [] as { blockerTaskId: string; blockedTaskId: string }[],
  };
  const requests: string[] = [];
  const hanging: { query: string; resolve: () => void }[] = [];
  const boardAnswer = (params: URLSearchParams) => {
    const tokens = (params.get('q') ?? '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const assigneeId = params.get('assigneeId');
    const rows = tasks.filter(
      (task) =>
        tokens.every((token) => task.title.toLowerCase().includes(token)) &&
        (assigneeId === null || task.assigneeId === assigneeId),
    );
    return json(200, {
      tasks: rows.map(wireTask),
      truncated: control.truncated,
      canEdit: control.canEdit,
    });
  };
  vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
    const raw =
      typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString();
    const url = new URL(raw, 'http://localhost');
    requests.push(`${url.pathname}${url.search}`);
    if (url.pathname === `/api/app/tasks/by-project/${PROJECT}`) {
      const query = url.searchParams.get('q') ?? '';
      const mode = query === '' ? control.board : control.searchedBoard;
      if (mode === 'fail') return json(503, { error: 'unavailable' });
      if (mode === 'hang') {
        return new Promise<Response>((resolve) => {
          hanging.push({
            query,
            resolve: () => resolve(boardAnswer(url.searchParams)),
          });
        });
      }
      return boardAnswer(url.searchParams);
    }
    if (url.pathname === `/api/app/tasks/dependencies/by-project/${PROJECT}`) {
      if (control.dependencies === 'fail') {
        return json(503, { error: 'unavailable' });
      }
      return json(200, { edges: control.edges });
    }
    if (
      url.pathname === `/api/app/tasks/ops-indicators/by-project/${PROJECT}`
    ) {
      if (control.activity === 'fail') {
        return json(503, { error: 'unavailable' });
      }
      return json(200, {
        runningTaskIds: [],
        askingTaskIds: [],
        pendingReviews: [],
      });
    }
    return json(404, { error: `unstubbed ${url.pathname}` });
  });
  const count = (path: string) =>
    requests.filter((request) => request.startsWith(path)).length;
  return { control, requests, hanging, count };
}

function renderWorkspace(view: 'board' | 'list' = 'board') {
  // The app's read policy retries a server fault three times before the
  // read settles as failed; no backoff here.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <TasksWorkspace
        organizationId={ORG}
        projectId={PROJECT}
        view={view}
        onViewChange={() => {}}
      />
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient };
}

/** 26 matching To do tasks: the OLDEST is the only Urgent one (the #3745
 * fixture), 25 newer Medium ones share the term; one task never matches. */
function searchFixture(): FakeTask[] {
  const rows: FakeTask[] = [
    {
      id: 't1',
      title: 'needle urgent oldest',
      status: 'todo',
      priority: 'p0',
      assigneeId: null,
    },
  ];
  for (let i = 2; i <= 26; i += 1) {
    rows.push({
      id: `t${i}`,
      title: `needle item ${i}`,
      status: i % 3 === 0 ? 'in_progress' : 'todo',
      priority: 'p2',
      assigneeId: i % 2 === 0 ? ME : null,
    });
  }
  rows.push({
    id: 't99',
    title: 'Unrelated control',
    status: 'todo',
    priority: 'p0',
    assigneeId: null,
  });
  return rows;
}

const titleButton = (title: string) =>
  screen.queryByRole('button', { name: title });

async function search(user: UserEvent, text: string) {
  const box = screen.getByPlaceholderText('Search tasks');
  // The box stays read-only until it has the focus (an anti-autofill trick).
  await user.click(box);
  await user.clear(box);
  // Pasted whole, so no debounced prefix of the query is ever searched: on
  // a slow runner a typed prefix could fail and answer after the query.
  if (text.length > 0) await user.paste(text);
}

async function pickFacet(user: UserEvent, section: string, option: string) {
  await user.click(screen.getByRole('button', { name: 'Filter' }));
  const panel = await screen.findByRole('dialog', { name: 'Filters' });
  await user.click(within(panel).getByRole('button', { name: section }));
  const choice = within(panel).queryByRole('radio', { name: option });
  await user.click(
    choice ?? within(panel).getByRole('checkbox', { name: option }),
  );
  await user.keyboard('{Escape}');
}

const alertSaying = (text: string | RegExp) =>
  screen
    .queryAllByRole('alert')
    .find((alert) =>
      typeof text === 'string'
        ? alert.textContent?.includes(text)
        : text.test(alert.textContent ?? ''),
    );

const TASKS_FAILED =
  "Couldn't load the tasks, so none are shown. Your search and filters stay as they are.";

let savedEnv: typeof window.__ENV__;

beforeEach(() => {
  savedEnv = window.__ENV__;
  window.__ENV__ = { BASE_PATH: '' };
  localStorage.clear();
});

afterEach(() => {
  window.__ENV__ = savedEnv;
  vi.restoreAllMocks();
});

describe('a search reaches every matching task (#3745)', () => {
  it('keeps the facet match that 25 newer matches used to crowd out', async () => {
    const backend = fakeBoardBackend(searchFixture());
    const { user } = renderWorkspace('list');

    await screen.findByRole('button', { name: 'needle item 26' });
    await pickFacet(user, 'Priority', 'Urgent');
    await waitFor(() =>
      expect(titleButton('needle item 26')).not.toBeInTheDocument(),
    );
    expect(titleButton('needle urgent oldest')).toBeInTheDocument();
    expect(titleButton('Unrelated control')).toBeInTheDocument();

    await search(user, 'needle');
    await waitFor(() =>
      expect(titleButton('Unrelated control')).not.toBeInTheDocument(),
    );
    expect(titleButton('needle urgent oldest')).toBeInTheDocument();
    // The search rode the board read itself; no capped search was asked.
    expect(
      backend.requests.some(
        (request) =>
          request.startsWith(`/api/app/tasks/by-project/${PROJECT}?`) &&
          request.includes('q=needle'),
      ),
    ).toBe(true);
    expect(backend.count('/api/app/tasks/search')).toBe(0);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('shows every one of more than 25 matches, lane counts included', async () => {
    fakeBoardBackend(searchFixture());
    const { user } = renderWorkspace('board');

    await screen.findByRole('button', { name: 'needle item 26' });
    await search(user, 'needle');
    await waitFor(() =>
      expect(titleButton('Unrelated control')).not.toBeInTheDocument(),
    );
    const titles = screen
      .getAllByRole('button')
      .filter((button) => button.textContent?.startsWith('needle'));
    expect(titles).toHaveLength(26);
    // 8 of the 26 sit In progress (every third id); the rest are To do. A
    // lane counts what it shows.
    const laneOf = (title: string) => {
      const lane = titleButton(title)?.closest('section');
      if (!lane) throw new Error(`no lane holds ${title}`);
      return lane;
    };
    expect(
      within(laneOf('needle urgent oldest')).getByText('18'),
    ).toBeVisible();
    expect(within(laneOf('needle item 3')).getByText('8')).toBeVisible();
  });

  it('answers a search that matches nothing with the empty lanes, not a failure', async () => {
    fakeBoardBackend(searchFixture());
    const { user } = renderWorkspace('board');

    await screen.findByRole('button', { name: 'needle item 26' });
    await search(user, 'no-such-token');
    await waitFor(() =>
      expect(titleButton('needle item 26')).not.toBeInTheDocument(),
    );
    expect(screen.getAllByText('No tasks')).toHaveLength(6);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});

describe('a failed read is never an empty or unfiltered board (#3747)', () => {
  it.each(['board', 'list'] as const)(
    'shows a failed first read of the %s with Try again, not empty lanes',
    async (view) => {
      const backend = fakeBoardBackend(searchFixture());
      backend.control.board = 'fail';
      const { user } = renderWorkspace(view);

      await waitFor(() => expect(alertSaying(TASKS_FAILED)).toBeDefined());
      // Four attempts — the first and three retries — then it settled.
      expect(backend.count(`/api/app/tasks/by-project/${PROJECT}`)).toBe(4);
      expect(screen.queryAllByText('No tasks')).toHaveLength(0);
      expect(titleButton('needle item 26')).not.toBeInTheDocument();
      // The controls stay usable: nothing says the board is empty.
      expect(screen.getByRole('button', { name: 'Filter' })).toBeEnabled();
      expect(
        screen.getByRole('button', { name: 'Create task' }),
      ).toBeInTheDocument();

      backend.control.board = 'ok';
      await user.click(
        within(alertSaying(TASKS_FAILED) as HTMLElement).getByRole('button', {
          name: 'Try again',
        }),
      );
      expect(
        await screen.findByRole('button', { name: 'needle item 26' }),
      ).toBeInTheDocument();
      expect(alertSaying(TASKS_FAILED)).toBeUndefined();
      // The focus that pressed Try again lands on the board it brought back.
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole('region', {
            name: view === 'board' ? 'Board' : 'List',
          }),
        ),
      );
    },
  );

  it('keeps the loaded rows through a failed refresh and says they are stale', async () => {
    const backend = fakeBoardBackend(searchFixture());
    const { user, queryClient } = renderWorkspace('board');
    await screen.findByRole('button', { name: 'needle item 26' });

    backend.control.board = 'fail';
    await queryClient.refetchQueries({ type: 'active' });
    const stale =
      "Couldn't refresh the tasks. They are shown as they were last loaded.";
    await waitFor(() => expect(alertSaying(stale)).toBeDefined());
    expect(titleButton('needle item 26')).toBeInTheDocument();

    backend.control.board = 'ok';
    await user.click(
      within(alertSaying(stale) as HTMLElement).getByRole('button', {
        name: 'Try again',
      }),
    );
    await waitFor(() => expect(alertSaying(stale)).toBeUndefined());
    expect(titleButton('needle item 26')).toBeInTheDocument();
  });

  it('never shows unfiltered rows under a search that failed, and recovers it', async () => {
    const backend = fakeBoardBackend(searchFixture());
    const { user } = renderWorkspace('list');
    await screen.findByRole('button', { name: 'needle item 26' });

    backend.control.searchedBoard = 'fail';
    await search(user, 'needle urgent');
    await waitFor(() => expect(alertSaying(TASKS_FAILED)).toBeDefined());
    expect(titleButton('needle item 26')).not.toBeInTheDocument();
    expect(titleButton('Unrelated control')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search tasks')).toHaveValue(
      'needle urgent',
    );

    backend.control.searchedBoard = 'ok';
    await user.click(
      within(alertSaying(TASKS_FAILED) as HTMLElement).getByRole('button', {
        name: 'Try again',
      }),
    );
    expect(
      await screen.findByRole('button', { name: 'needle urgent oldest' }),
    ).toBeInTheDocument();
    expect(titleButton('needle item 26')).not.toBeInTheDocument();
    expect(alertSaying(TASKS_FAILED)).toBeUndefined();
  });

  it('shows the new search when the scope changes while a retry is pending', async () => {
    const backend = fakeBoardBackend(searchFixture());
    const { user } = renderWorkspace('list');
    await screen.findByRole('button', { name: 'needle item 26' });

    backend.control.searchedBoard = 'fail';
    await search(user, 'needle urgent');
    await waitFor(() => expect(alertSaying(TASKS_FAILED)).toBeDefined());

    // Try again, and while that answer is still out, search something else.
    backend.control.searchedBoard = 'hang';
    await user.click(
      within(alertSaying(TASKS_FAILED) as HTMLElement).getByRole('button', {
        name: 'Try again',
      }),
    );
    await waitFor(() => expect(alertSaying('Trying again')).toBeDefined());
    // A slow keyboard can leave a debounced partial query retrying too; only
    // the retried search matters here.
    const retried = () =>
      backend.hanging.filter((held) => held.query === 'needle urgent');
    await waitFor(() => expect(retried()).toHaveLength(1));
    backend.control.searchedBoard = 'ok';
    await search(user, 'needle item 2');
    expect(
      await screen.findByRole('button', { name: 'needle item 20' }),
    ).toBeInTheDocument();
    expect(alertSaying(TASKS_FAILED)).toBeUndefined();

    // The retried answer for the old search lands late: it stays out.
    for (const held of backend.hanging) held.resolve();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(titleButton('needle urgent oldest')).not.toBeInTheDocument();
    expect(titleButton('needle item 20')).toBeInTheDocument();
  });

  it('names failed dependencies over a standing board and retries them alone', async () => {
    const backend = fakeBoardBackend(searchFixture());
    backend.control.dependencies = 'fail';
    backend.control.edges = [{ blockerTaskId: 't2', blockedTaskId: 't4' }];
    const { user } = renderWorkspace('board');

    const failed =
      "Couldn't load the dependencies, so blocked tasks may not be marked as blocked.";
    await waitFor(() => expect(alertSaying(failed)).toBeDefined());
    expect(titleButton('needle item 26')).toBeInTheDocument();
    expect(screen.queryAllByLabelText('Blocked')).toHaveLength(0);

    const boardReads = backend.count(`/api/app/tasks/by-project/${PROJECT}`);
    backend.control.dependencies = 'ok';
    await user.click(
      within(alertSaying(failed) as HTMLElement).getByRole('button', {
        name: 'Try again',
      }),
    );
    await waitFor(() => expect(alertSaying(failed)).toBeUndefined());
    expect(await screen.findAllByLabelText('Blocked')).toHaveLength(1);
    // Scoped: the board itself was not read again.
    expect(backend.count(`/api/app/tasks/by-project/${PROJECT}`)).toBe(
      boardReads,
    );
  });

  it('says Needs my review may leave tasks out when the activity read fails', async () => {
    const backend = fakeBoardBackend(searchFixture());
    backend.control.activity = 'fail';
    const { user } = renderWorkspace('board');

    await waitFor(() =>
      expect(
        alertSaying("Couldn't load agent and review activity."),
      ).toBeDefined(),
    );
    expect(alertSaying('Needs my review')).toBeUndefined();
    await pickFacet(user, 'Review', 'Needs my review');
    await waitFor(() =>
      expect(
        alertSaying('"Needs my review" may leave out tasks that wait on you.'),
      ).toBeDefined(),
    );
  });

  it('shows a truly empty board as empty lanes, with no alert', async () => {
    fakeBoardBackend([]);
    renderWorkspace('board');

    await waitFor(() =>
      expect(screen.getAllByText('No tasks')).toHaveLength(6),
    );
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('says so when the board stops at its cap', async () => {
    const backend = fakeBoardBackend(searchFixture());
    backend.control.truncated = true;
    renderWorkspace('board');

    expect(
      await screen.findByText(
        'Showing the first 27 tasks. Search to find the others.',
      ),
    ).toBeInTheDocument();
  });
});
