import type { ProjectDispatchStatus } from '@tale/shared/schemas/project-dispatch';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AbilityContext } from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { checkAccessibility } from '@/tests/utils/a11y';
import { i18n } from '@/tests/utils/i18n-all-languages';
import { forgetSavedLocale, saveLocale } from '@/tests/utils/lapsed-session';
import {
  configure,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';
import {
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { ProjectDispatchTab } from './project-dispatch-tab';

// The page of a project's dispatch, against a closed synthetic transport:
// the real reads, writes, adapters and retry policy run; only the project,
// its agents and its tasks are stand-ins. Every name is synthetic.

configure({ asyncUtilTimeout: 10_000 });

const { toast, project } = vi.hoisted(() => ({
  toast: vi.fn(),
  project: { archived: false },
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast,
  useToast: () => ({ toast, toasts: [], dismiss: vi.fn() }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useParams: () => ({ id: 'org-1' }),
  Link: ({
    children,
    to,
    params,
    search: _search,
    ...rest
  }: {
    children?: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: unknown;
    [key: string]: unknown;
  }) =>
    createElement(
      'a',
      {
        ...rest,
        href: Object.entries(params ?? {}).reduce(
          (href, [name, value]) => href.replace(`$${name}`, value),
          to,
        ),
      },
      children,
    ),
}));

vi.mock('../hooks/queries', () => ({
  useProject: () => ({
    project: {
      _id: 'proj-1',
      key: 'TAL',
      ...(project.archived ? { archivedAt: 1_789_000_000_000 } : {}),
    },
    isLoading: false,
  }),
  useProjectAgents: () => ({
    agents: [
      { _id: 'agent-scribe', name: 'Scribe' },
      { _id: 'agent-lector', name: 'Lector' },
    ],
  }),
}));

vi.mock('@/app/features/tasks/hooks/queries', () => ({
  useTaskLabels: () => ({ labels: [], isLoading: false }),
  useTasksByProject: () => ({ tasks: [] }),
}));

const STATUS =
  /^GET \/api\/app\/tasks\/dispatch\/by-project\/proj-1\?orgId=org-1$/;
const PASS =
  /^POST \/api\/app\/tasks\/dispatch\/by-project\/proj-1\/pass\?orgId=org-1$/;
const GATE =
  /^POST \/api\/app\/tasks\/dispatch\/by-project\/proj-1\/gates\/ci\?orgId=org-1$/;
const WRITES = /^(POST|PUT|PATCH|DELETE) /;

const NOW = Date.now();
const HASH = 'a'.repeat(64);

type PoolAgent = ProjectDispatchStatus['pool'][number];
type AgentRun = PoolAgent['runs'][number];

/** The counts a readback gives for the runs it lists, when it lists them
 * all. */
function countsOf(runs: readonly AgentRun[]): PoolAgent['runCounts'] {
  const counts: PoolAgent['runCounts'] = {
    total: runs.length,
    running: 0,
    queued: 0,
    waiting: {},
  };
  for (const run of runs) {
    if (run.status === 'running') counts.running += 1;
    else if (run.waitingReason === null) counts.queued += 1;
    else
      counts.waiting[run.waitingReason] =
        (counts.waiting[run.waitingReason] ?? 0) + 1;
  }
  return counts;
}

function poolAgent(
  agent: Pick<PoolAgent, 'agentId' | 'name'> & Partial<PoolAgent>,
): PoolAgent {
  return {
    model: 'gpt-6.1-sol',
    modelProvider: 'openai',
    runs: [],
    runCounts: countsOf(agent.runs ?? []),
    capacity: 1,
    modelHeldUntil: null,
    idle: 'no_ready_work',
    ...agent,
  };
}

function readback(
  overrides: Partial<ProjectDispatchStatus> = {},
): ProjectDispatchStatus {
  return {
    configured: true,
    unreadable: false,
    config: {
      enabled: true,
      agents: ['agent-scribe', 'agent-lector'],
      maxConcurrentRuns: 2,
      statuses: ['todo'],
      assignment: 'assigned',
    },
    hash: HASH,
    canEdit: true,
    state: {
      lastPassAt: NOW - 120_000,
      lastStartAt: null,
      nextPassAt: null,
      lastStopReason: 'no_ready_work',
    },
    pool: [
      poolAgent({ agentId: 'agent-scribe', name: 'Scribe' }),
      poolAgent({ agentId: 'agent-lector', name: 'Lector' }),
    ],
    standingRoles: [],
    sources: [],
    reviewers: [],
    servedBy: [],
    holds: [],
    gates: [],
    workers: { limit: 2, inUse: 0 },
    poolExceedsWorkers: false,
    passes: [],
    ...overrides,
  };
}

const NOT_SET_UP = readback({
  configured: false,
  config: null,
  hash: null,
  state: null,
  pool: [],
});

const t = (key: string, values?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'projects', ...values });
const tTasks = (key: string) => i18n.t(key, { ns: 'tasks' });

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState(
    {},
    '',
    '/dashboard/org-1/projects/proj-1/dispatch',
  );
  backend = syntheticBackend();
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
  project.archived = false;
  toast.mockReset();
});

afterEach(async () => {
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

function answer(status: ProjectDispatchStatus) {
  backend.on(STATUS, () => Response.json(status));
}

/** What each role may do, built once. */
const ABILITIES = {
  reader: defineAbilityFor('disabled'),
  admin: defineAbilityFor('admin'),
};

function renderTab(role: keyof typeof ABILITIES = 'reader') {
  return render(
    <AbilityContext.Provider value={ABILITIES[role]}>
      <QueryClientProvider client={client}>
        <ProjectDispatchTab organizationId="org-1" projectId="proj-1" />
      </QueryClientProvider>
    </AbilityContext.Provider>,
  );
}

async function table(caption: string): Promise<HTMLElement> {
  return screen.findByRole('table', { name: caption });
}

/** The row of a table that carries `text`. */
function rowOf(scope: HTMLElement, text: string): HTMLElement {
  const row = within(scope).getByText(text).closest('tr');
  if (row === null) throw new Error(`"${text}" is in no row`);
  return row;
}

describe('the Dispatch page of a project without a dispatch', () => {
  it('invites an administrator to set it up, and offers no pass or edit', async () => {
    answer(NOT_SET_UP);
    renderTab();
    expect(
      await screen.findByRole('heading', {
        name: t('dispatch.notSetUp.title'),
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(t('dispatch.notSetUp.body'))).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t('dispatch.notSetUp.action') }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t('dispatch.edit') }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t('dispatch.runPass') }),
    ).not.toBeInTheDocument();
  });

  it('tells a reader who sets it up instead of offering it', async () => {
    answer({ ...NOT_SET_UP, canEdit: false });
    renderTab();
    expect(
      await screen.findByText(t('dispatch.notSetUp.readerBody')),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t('dispatch.readerDescription')),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t('dispatch.notSetUp.action') }),
    ).not.toBeInTheDocument();
  });
});

describe('the Dispatch page of a dispatch a newer version saved', () => {
  it('says so, and offers neither an editor, a set-up nor a pass', async () => {
    answer({
      ...NOT_SET_UP,
      configured: true,
      unreadable: true,
    });
    renderTab();
    expect(
      await screen.findByText(t('dispatch.unreadable.title')),
    ).toBeInTheDocument();
    expect(screen.getByText(t('dispatch.unreadable.body'))).toBeInTheDocument();
    for (const name of [
      t('dispatch.edit'),
      t('dispatch.notSetUp.action'),
      t('dispatch.runPass'),
    ]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(
      screen.queryByText(t('dispatch.notSetUp.title')),
    ).not.toBeInTheDocument();
  });
});

describe('the Dispatch page of a configured dispatch', () => {
  it('names why each idle agent of the pool is idle', async () => {
    const reasons = [
      'model_capacity',
      'host_pressure',
      'org_limit',
      'pacing',
      'gated',
      'no_ready_work',
      'disabled',
      'unknown',
    ] as const;
    answer(
      readback({
        pool: reasons.map((reason) =>
          poolAgent({
            agentId: `agent-${reason}`,
            name: `Agent ${reason}`,
            idle: reason,
          }),
        ),
      }),
    );
    renderTab();
    const agents = await table(t('dispatch.agents.caption'));
    for (const reason of reasons) {
      expect(
        within(rowOf(agents, `Agent ${reason}`)).getByText(
          t(`dispatch.idle.${reason}`),
        ),
      ).toBeInTheDocument();
    }
  });

  it('shows the runs an agent holds, each task opening, and why a run waits', async () => {
    answer(
      readback({
        pool: [
          poolAgent({
            agentId: 'agent-scribe',
            name: 'Scribe',
            idle: null,
            capacity: 3,
            runs: [
              {
                runId: 'run-1',
                taskId: 'task-changelog',
                projectId: 'proj-1',
                taskNumber: 12,
                taskTitle: 'Changelog',
                status: 'running',
                waitingReason: null,
              },
              {
                runId: 'run-2',
                taskId: 'task-press',
                projectId: 'proj-1',
                taskNumber: 13,
                taskTitle: 'Press kit',
                status: 'queued',
                waitingReason: 'model_capacity',
              },
              {
                runId: 'run-3',
                taskId: 'task-sitemap',
                projectId: 'proj-1',
                taskNumber: null,
                taskTitle: 'Sitemap',
                status: 'queued',
                waitingReason: null,
              },
            ],
          }),
        ],
      }),
    );
    renderTab();
    const agents = await table(t('dispatch.agents.caption'));
    const scribe = rowOf(agents, 'Scribe');
    expect(
      within(scribe).getByRole('link', { name: 'TAL-12 Changelog' }),
    ).toHaveAttribute('href', '/dashboard/org-1/tasks/task-changelog');
    expect(
      within(scribe).getByRole('link', { name: 'Sitemap' }),
    ).toHaveAttribute('href', '/dashboard/org-1/tasks/task-sitemap');
    expect(
      within(scribe).getByText(t('dispatch.agents.running')),
    ).toBeVisible();
    expect(
      within(scribe).getByText(tTasks('agentRun.waiting.model_capacity')),
    ).toBeInTheDocument();
    expect(within(scribe).getByText(t('dispatch.agents.queued'))).toBeVisible();
    // Working, so not idle: its summary counts the three runs.
    expect(screen.getByText('3 of 2')).toBeInTheDocument();
  });

  it('keeps an agent on hundreds of runs to one row: counts, five runs, the rest of the list on request [TASK-R46]', async () => {
    // The readback lists an agent's 50 oldest runs and counts all 256.
    const listed = Array.from({ length: 50 }, (_, index): AgentRun => ({
      runId: `run-${index}`,
      taskId: `task-${index}`,
      projectId: 'proj-1',
      taskNumber: index + 1,
      taskTitle: `Fleet task ${index + 1}`,
      status: index < 44 ? 'running' : 'queued',
      waitingReason: index < 44 ? null : 'model_capacity',
    }));
    answer(
      readback({
        config: {
          enabled: true,
          agents: ['agent-scribe'],
          maxConcurrentRuns: 256,
          perAgentConcurrency: 256,
          statuses: ['todo'],
          assignment: 'pool',
        },
        pool: [
          poolAgent({
            agentId: 'agent-scribe',
            name: 'Scribe',
            idle: null,
            capacity: 256,
            runs: listed,
            runCounts: {
              total: 256,
              running: 244,
              queued: 4,
              waiting: { model_capacity: 6, org_limit: 2 },
            },
          }),
        ],
        workers: { limit: 256, inUse: 250 },
      }),
    );
    const { user } = renderTab();
    const agents = await table(t('dispatch.agents.caption'));
    const scribe = rowOf(agents, 'Scribe');
    const runLinks = () =>
      within(scribe)
        .getAllByRole('link')
        .filter((link) => link.textContent?.includes('Fleet task'));

    expect(runLinks()).toHaveLength(5);
    for (const [label, count] of [
      [t('dispatch.agents.running'), 244],
      [t('dispatch.agents.queued'), 4],
      [tTasks('agentRun.waiting.model_capacity'), 6],
      [tTasks('agentRun.waiting.org_limit'), 2],
    ] as const) {
      expect(
        within(scribe).getByText(
          t('dispatch.agents.runCount', { label, count }),
        ),
      ).toBeInTheDocument();
    }
    expect(screen.getByText('256 of 256')).toBeInTheDocument();
    expect(
      within(scribe).queryByText(
        t('dispatch.agents.notListed', { count: 206 }),
      ),
    ).not.toBeInTheDocument();

    const more = within(scribe).getByRole('button', {
      name: t('dispatch.agents.showMore', { count: 45 }),
    });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);

    expect(runLinks()).toHaveLength(50);
    const fewer = within(scribe).getByRole('button', {
      name: t('dispatch.agents.showFewer'),
    });
    expect(fewer).toHaveAttribute('aria-expanded', 'true');
    expect(
      document.getElementById(fewer.getAttribute('aria-controls') ?? ''),
    ).toContainElement(runLinks()[49] ?? null);
    expect(
      within(scribe).getByText(t('dispatch.agents.notListed', { count: 206 })),
    ).toBeInTheDocument();

    await user.click(fewer);
    expect(runLinks()).toHaveLength(5);
  });

  it('says when the pool can hold more runs than the organization has agent workers', async () => {
    answer(
      readback({
        config: {
          enabled: true,
          agents: ['agent-scribe', 'agent-lector'],
          maxConcurrentRuns: 4,
          statuses: ['todo'],
          assignment: 'assigned',
        },
        workers: { limit: 1, inUse: 1 },
        poolExceedsWorkers: true,
      }),
    );
    const { unmount } = renderTab();
    expect(
      await screen.findByText(t('dispatch.workersWarning.title')),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        t('dispatch.workersWarning.body', { runs: 2, workers: 1 }),
      ),
    ).toBeInTheDocument();
    // Only who may change the organization's limits is sent to them.
    expect(
      screen.queryByRole('link', { name: t('dispatch.workersWarning.manage') }),
    ).not.toBeInTheDocument();
    unmount();

    renderTab('admin');
    expect(
      await screen.findByRole('link', {
        name: t('dispatch.workersWarning.manage'),
      }),
    ).toHaveAttribute('href', '/dashboard/org-1/settings/sandboxes');
  });

  it('names the models the dispatch waits on while they are at capacity', async () => {
    answer(
      readback({
        holds: [
          {
            modelProvider: 'openai',
            model: 'gpt-6.1-sol',
            heldUntil: NOW + 5 * 60_000,
            consecutive: 2,
            firstRefusedAt: NOW - 60_000,
          },
        ],
      }),
    );
    renderTab();
    expect(
      await screen.findByText(t('dispatch.holds.title', { count: 1 })),
    ).toBeInTheDocument();
    expect(screen.getByText(t('dispatch.holds.body'))).toBeInTheDocument();
    expect(screen.getByText(/^gpt-6\.1-sol \(openai\) until /)).toBeVisible();
  });

  it('shows each gate held or open, and when nobody reported on it lately', async () => {
    answer(
      readback({
        // As a reader sees them: no Hold and Open beside the states.
        canEdit: false,
        gates: [
          {
            key: 'ci',
            labels: ['builds'],
            held: true,
            stale: false,
            holdAt: 20,
            recoverBelow: 10,
            whenStale: 'open',
            value: 23,
            reason: 'Runner queue is full',
            reportedAt: NOW - 30_000,
            reportedBy: 'api-key:key-1',
            spacedUntil: null,
          },
          {
            key: 'deploy',
            labels: null,
            held: false,
            stale: true,
            holdAt: null,
            recoverBelow: null,
            whenStale: 'open',
            value: null,
            reason: null,
            reportedAt: null,
            reportedBy: null,
            spacedUntil: null,
          },
        ],
      }),
    );
    renderTab();
    const gates = await table(t('dispatch.gates.caption'));
    const ci = rowOf(gates, 'ci');
    expect(
      within(ci).getByText(t('dispatch.gates.states.held')),
    ).toBeInTheDocument();
    expect(
      within(ci).getByText(
        t('dispatch.gates.value', { value: 23, holdAt: 20 }),
      ),
    ).toBeInTheDocument();
    expect(within(ci).getByText('Runner queue is full')).toBeInTheDocument();
    const deploy = rowOf(gates, 'deploy');
    expect(
      within(deploy).getByText(t('dispatch.gates.states.open')),
    ).toBeInTheDocument();
    expect(
      within(deploy).getByText(t('dispatch.gates.states.stale')),
    ).toBeInTheDocument();
    expect(
      within(deploy).getByText(t('dispatch.gates.allWork')),
    ).toBeInTheDocument();
    expect(
      within(deploy).getByText(t('dispatch.gates.noReport')),
    ).toBeInTheDocument();
  });

  it('names what asked for each recent pass and why it stopped', async () => {
    answer(
      readback({
        passes: [
          {
            id: 'pass-2',
            trigger: 'manual',
            startedAt: NOW - 10_000,
            stopReason: 'host_pressure',
            started: 0,
            held: 1,
            nextPassAt: NOW + 50_000,
          },
          {
            id: 'pass-1',
            trigger: 'scan',
            startedAt: NOW - 70_000,
            stopReason: 'started',
            started: 2,
            held: 0,
            nextPassAt: null,
          },
        ],
      }),
    );
    renderTab();
    const passes = await table(t('dispatch.passes.caption'));
    const manual = rowOf(passes, t('dispatch.passes.trigger.manual'));
    expect(
      within(manual).getByText(t('dispatch.passes.stop.host_pressure')),
    ).toBeInTheDocument();
    const scan = rowOf(passes, t('dispatch.passes.trigger.scan'));
    expect(
      within(scan).getByText(t('dispatch.passes.stop.started')),
    ).toBeInTheDocument();
    expect(within(scan).getByText('2')).toBeInTheDocument();
  });

  it('says what each standing role did at its last occurrence', async () => {
    answer(
      readback({
        standingRoles: [
          {
            key: 'manager',
            agentId: 'agent-scribe',
            taskId: 'task-routing',
            taskTitle: 'Route reviews',
            mode: 'full',
            cron: '0,30 * * * *',
            timezone: 'Europe/Zurich',
            nextAt: NOW + 20 * 60_000,
            last: {
              label: 'manager 2026-10-14 16:30 Europe/Zurich',
              outcome: 'refused',
              runId: null,
              reason: 'paused',
              at: NOW - 10 * 60_000,
            },
          },
          {
            key: 'nightly',
            agentId: 'agent-gone',
            taskId: 'task-gone',
            taskTitle: null,
            mode: null,
            cron: '0 2 * * *',
            timezone: 'UTC',
            nextAt: null,
            last: null,
          },
        ],
      }),
    );
    renderTab();
    const roles = await table(t('dispatch.roles.caption'));
    const manager = rowOf(roles, 'manager');
    expect(within(manager).getByText('Scribe')).toBeInTheDocument();
    expect(
      within(manager).getByRole('link', { name: 'Route reviews' }),
    ).toHaveAttribute('href', '/dashboard/org-1/tasks/task-routing');
    expect(
      within(manager).getByText(t('dispatch.roles.refusal.paused')),
    ).toBeInTheDocument();
    const nightly = rowOf(roles, 'nightly');
    expect(
      within(nightly).getByText(t('dispatch.roles.unknownAgent')),
    ).toBeInTheDocument();
    expect(
      within(nightly).getByText(t('dispatch.roles.unknownTask')),
    ).toBeInTheDocument();
    expect(
      within(nightly).getByText(t('dispatch.roles.notYet')),
    ).toBeInTheDocument();
  });

  it('passes an accessibility check', async () => {
    answer(
      readback({
        poolExceedsWorkers: true,
        holds: [
          {
            modelProvider: '',
            model: 'local-model',
            heldUntil: NOW + 60_000,
            consecutive: 1,
            firstRefusedAt: NOW,
          },
        ],
      }),
    );
    const view = renderTab();
    await table(t('dispatch.agents.caption'));
    // The tab's header sits under the page's own headings in the app; the
    // Alert's fixed level-5 heading follows it here.
    await checkAccessibility(view, {
      rules: { 'heading-order': { enabled: false } },
    });
  });
});

describe('the Dispatch page of a dispatch that serves other boards', () => {
  it('lists every board it serves, served or skipped with why, and its reviewers [TASK-R72]', async () => {
    answer(
      readback({
        sources: [
          {
            projectId: 'proj-tale',
            name: 'Tale',
            reachable: true,
            skipped: null,
            statuses: ['backlog', 'todo'],
            labels: { include: ['ready'], exclude: ['blocked'] },
          },
          {
            projectId: 'proj-vat',
            name: 'Billing',
            reachable: false,
            skipped: 'no_authority',
            statuses: ['todo'],
            labels: null,
          },
          {
            projectId: 'proj-archive',
            name: 'Archive',
            reachable: false,
            skipped: 'archived',
            statuses: ['todo'],
            labels: null,
          },
          {
            projectId: 'proj-gone',
            name: null,
            reachable: false,
            skipped: 'missing',
            statuses: ['todo'],
            labels: null,
          },
        ],
        reviewers: [
          { agentId: 'agent-reviewer', name: 'Reviewer agent' },
          { agentId: 'agent-gone', name: null },
        ],
      }),
    );
    renderTab();
    const sources = await table(t('dispatch.sources.caption'));
    const tale = rowOf(sources, 'Tale');
    expect(within(tale).getByRole('link', { name: 'Tale' })).toHaveAttribute(
      'href',
      '/dashboard/org-1/projects/proj-tale/dispatch',
    );
    expect(
      within(tale).getByText(t('dispatch.sources.served')),
    ).toBeInTheDocument();
    expect(
      within(tale).getByText(
        `${tTasks('status.backlog')}, ${tTasks('status.todo')}`,
      ),
    ).toBeInTheDocument();
    expect(
      within(tale).getByText(t('dispatch.sources.only', { labels: 'ready' })),
    ).toBeInTheDocument();
    expect(
      within(tale).getByText(
        t('dispatch.sources.never', { labels: 'blocked' }),
      ),
    ).toBeInTheDocument();
    expect(
      within(rowOf(sources, 'Billing')).getByText(
        t('dispatch.sources.skipped.no_authority'),
      ),
    ).toBeInTheDocument();
    expect(
      within(rowOf(sources, 'Archive')).getByText(
        t('dispatch.sources.skipped.archived'),
      ),
    ).toBeInTheDocument();
    expect(
      within(rowOf(sources, t('dispatch.sources.unknownProject'))).getByText(
        t('dispatch.sources.skipped.missing'),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: t('dispatch.reviewers.title') }),
    ).toBeInTheDocument();
    expect(screen.getByText('Reviewer agent')).toBeInTheDocument();
    expect(
      screen.getByText(t('dispatch.reviewers.unknownAgent')),
    ).toBeInTheDocument();
  });

  it('names the board of a run on another board instead of numbering it with this project’s key [TASK-R71]', async () => {
    answer(
      readback({
        sources: [
          {
            projectId: 'proj-tale',
            name: 'Tale',
            reachable: true,
            skipped: null,
            statuses: ['todo'],
            labels: null,
          },
        ],
        pool: [
          poolAgent({
            agentId: 'agent-scribe',
            name: 'Scribe',
            idle: null,
            runs: [
              {
                runId: 'run-own',
                taskId: 'task-own',
                projectId: 'proj-1',
                taskNumber: 4,
                taskTitle: 'Changelog',
                status: 'running',
                waitingReason: null,
              },
              {
                runId: 'run-tale',
                taskId: 'task-tale',
                projectId: 'proj-tale',
                taskNumber: 9,
                taskTitle: 'Fix the importer',
                status: 'running',
                waitingReason: null,
              },
            ],
          }),
        ],
      }),
    );
    renderTab();
    const agents = await table(t('dispatch.agents.caption'));
    const scribe = rowOf(agents, 'Scribe');
    expect(
      within(scribe).getByRole('link', { name: 'TAL-4 Changelog' }),
    ).toBeInTheDocument();
    expect(
      within(scribe).getByRole('link', { name: 'Fix the importer' }),
    ).toHaveAttribute('href', '/dashboard/org-1/tasks/task-tale');
    expect(within(scribe).getByText('Tale')).toBeInTheDocument();
  });

  it('shows neither section for a dispatch that serves no other board', async () => {
    answer(readback());
    renderTab();
    await table(t('dispatch.agents.caption'));
    expect(
      screen.queryByRole('table', { name: t('dispatch.sources.caption') }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t('dispatch.reviewers.title') }),
    ).not.toBeInTheDocument();
  });
});

describe('a board says which other projects’ dispatches serve it [TASK-R76]', () => {
  it('names each serving dispatch on a board without one of its own, switched off or skipped with why', async () => {
    answer({
      ...NOT_SET_UP,
      servedBy: [
        {
          projectId: 'proj-dev',
          name: 'Development',
          enabled: true,
          reachable: true,
          skipped: null,
        },
        {
          projectId: 'proj-support',
          name: 'Support',
          enabled: false,
          reachable: false,
          skipped: 'no_authority',
        },
      ],
    });
    renderTab();
    expect(
      await screen.findByText(t('dispatch.servedBy.title', { count: 2 })),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: t('dispatch.servedBy.item', { project: 'Development' }),
      }),
    ).toHaveAttribute('href', '/dashboard/org-1/projects/proj-dev/dispatch');
    const support = screen
      .getByRole('link', {
        name: t('dispatch.servedBy.item', { project: 'Support' }),
      })
      .closest('li');
    expect(support).toHaveTextContent(t('dispatch.servedBy.off'));
    expect(support).toHaveTextContent(
      t('dispatch.sources.skipped.no_authority'),
    );
    // Its own dispatch is still not set up.
    expect(
      screen.getByRole('heading', { name: t('dispatch.notSetUp.title') }),
    ).toBeInTheDocument();
  });

  it('says nothing of it on a board nobody else serves', async () => {
    answer(NOT_SET_UP);
    renderTab();
    await screen.findByRole('heading', { name: t('dispatch.notSetUp.title') });
    expect(
      screen.queryByText(t('dispatch.servedBy.body')),
    ).not.toBeInTheDocument();
  });
});

describe('the Dispatch page names another project only to who may read it [TASK-R80]', () => {
  it('lists a served board the reader may not read without its name, and tells it from one that is gone', async () => {
    answer(
      readback({
        sources: [
          {
            projectId: 'proj-payroll',
            name: null,
            reachable: true,
            skipped: null,
            statuses: ['todo'],
            labels: null,
          },
          {
            projectId: 'proj-gone',
            name: null,
            reachable: false,
            skipped: 'missing',
            statuses: ['todo'],
            labels: null,
          },
        ],
      }),
    );
    renderTab();
    const sources = await table(t('dispatch.sources.caption'));
    const hidden = rowOf(sources, t('dispatch.sources.hiddenProject'));
    expect(
      within(hidden).getByText(t('dispatch.sources.served')),
    ).toBeInTheDocument();
    expect(within(hidden).queryByRole('link')).not.toBeInTheDocument();
    expect(
      within(rowOf(sources, t('dispatch.sources.unknownProject'))).getByText(
        t('dispatch.sources.skipped.missing'),
      ),
    ).toBeInTheDocument();
  });

  it('says a dispatch the reader may not read serves the board, without naming or linking it', async () => {
    answer({
      ...NOT_SET_UP,
      servedBy: [
        {
          projectId: 'proj-dev',
          name: null,
          enabled: true,
          reachable: true,
          skipped: null,
        },
      ],
    });
    renderTab();
    expect(
      await screen.findByText(t('dispatch.servedBy.hiddenItem')),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', {
        name: t('dispatch.servedBy.hiddenItem'),
      }),
    ).not.toBeInTheDocument();
  });
});

describe('what an administrator does on the Dispatch page', () => {
  it('asks for a pass, once, and says so', async () => {
    answer(readback());
    backend.on(PASS, () => Response.json({ ok: true }));
    const { user } = renderTab();
    await user.click(
      await screen.findByRole('button', { name: t('dispatch.runPass') }),
    );
    await waitFor(() => expect(backend.count(PASS)).toBe(1));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: t('dispatch.passRequested'),
          variant: 'success',
        }),
      ),
    );
  });

  it('reports a refused pass in one toast, in the refusal’s words', async () => {
    answer(readback());
    backend.on(PASS, () =>
      Response.json(
        {
          error: 'PROJECT_FORBIDDEN',
          message: 'Only who may administer the project asks for a pass',
        },
        { status: 403 },
      ),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user } = renderTab();
    await user.click(
      await screen.findByRole('button', { name: t('dispatch.runPass') }),
    );
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith({
      title: t('dispatch.passFailed'),
      description: 'Only who may administer the project asks for a pass',
      variant: 'destructive',
    });
  });

  it('holds and opens a gate', async () => {
    answer(
      readback({
        gates: [
          {
            key: 'ci',
            labels: null,
            held: false,
            stale: false,
            holdAt: null,
            recoverBelow: null,
            whenStale: 'open',
            value: null,
            reason: null,
            reportedAt: NOW - 1_000,
            reportedBy: 'user:user-1',
            spacedUntil: null,
          },
        ],
      }),
    );
    const sent: unknown[] = [];
    backend.on(GATE, (_url, init) => {
      sent.push(typeof init?.body === 'string' ? JSON.parse(init.body) : null);
      return Response.json({ ok: true, held: true, changed: true });
    });
    const { user } = renderTab();
    await user.click(
      await screen.findByRole('button', {
        name: t('dispatch.gates.holdAria', { key: 'ci' }),
      }),
    );
    await waitFor(() => expect(sent).toEqual([{ state: 'hold' }]));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: t('dispatch.gates.heldToast', { key: 'ci' }),
        }),
      ),
    );
    await user.click(
      screen.getByRole('button', {
        name: t('dispatch.gates.openAria', { key: 'ci' }),
      }),
    );
    await waitFor(() =>
      expect(sent).toEqual([{ state: 'hold' }, { state: 'open' }]),
    );
  });

  it('offers a reader no pass, no edit and no gate change', async () => {
    answer(
      readback({
        canEdit: false,
        gates: [
          {
            key: 'ci',
            labels: null,
            held: true,
            stale: false,
            holdAt: null,
            recoverBelow: null,
            whenStale: 'open',
            value: null,
            reason: null,
            reportedAt: NOW - 1_000,
            reportedBy: null,
            spacedUntil: null,
          },
        ],
      }),
    );
    renderTab();
    await table(t('dispatch.gates.caption'));
    for (const name of [
      t('dispatch.runPass'),
      t('dispatch.edit'),
      t('dispatch.gates.holdAria', { key: 'ci' }),
      t('dispatch.gates.openAria', { key: 'ci' }),
    ]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(backend.count(WRITES)).toBe(0);
  });

  it('offers no change on an archived project, and says why', async () => {
    project.archived = true;
    answer(readback());
    renderTab();
    expect(
      await screen.findByText(t('readOnlyBanner.archivedTitle')),
    ).toBeInTheDocument();
    await table(t('dispatch.agents.caption'));
    expect(
      screen.queryByRole('button', { name: t('dispatch.edit') }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t('dispatch.runPass') }),
    ).not.toBeInTheDocument();
  });

  it('names a read that failed, never a project without a dispatch', async () => {
    backend.on(STATUS, () =>
      Response.json({ error: 'Service unavailable' }, { status: 503 }),
    );
    renderTab();
    expect(await screen.findByText(t('dispatch.loadFailed'))).toBeVisible();
    expect(
      screen.queryByText(t('dispatch.notSetUp.title')),
    ).not.toBeInTheDocument();
  });
});

/** The labels the user guide names (`docs/<locale>/platform/projects/
 * dispatch.md`), character for character, so the page and its guide never
 * drift apart. */
const GUIDE_LABELS = {
  en: {
    'projects:dispatch.sources.title': 'Boards it serves',
    'projects:dispatch.sources.served': 'Served',
    'projects:dispatch.reviewers.title': 'Reviewers',
    'projects:dispatch.title': 'Dispatch',
    'projects:dispatch.edit': 'Edit',
    'projects:dispatch.runPass': 'Run a pass now',
    'projects:dispatch.agents.title': 'Agents',
    'projects:dispatch.agents.idleBecause': 'Idle because',
    'projects:dispatch.roles.title': 'Standing roles',
    'projects:dispatch.gates.title': 'Gates',
    'projects:dispatch.passes.title': 'Recent passes',
    'projects:dispatch.gates.hold': 'Hold',
    'projects:dispatch.gates.open': 'Open',
    'projects:dispatch.idle.model_capacity': 'Its model is at capacity',
    'projects:dispatch.idle.org_limit': 'All agent workers are in use',
    'projects:dispatch.idle.unknown': 'No pass yet',
    'projects:dispatch.editor.enabled': 'Dispatch is on',
    'projects:dispatch.editor.agents': 'Agents in the pool',
    'projects:dispatch.editor.recheck': 'Ask a busy host again after (seconds)',
    'projects:dispatch.editor.gates.recoverBelow': 'Open again below',
    'tasks:agentRuns.trigger.dispatch': 'Started by dispatch',
  },
  de: {
    'projects:dispatch.sources.title': 'Bediente Boards',
    'projects:dispatch.sources.served': 'Bedient',
    'projects:dispatch.reviewers.title': 'Reviewer',
    'projects:dispatch.title': 'Arbeitsverteilung',
    'projects:dispatch.edit': 'Bearbeiten',
    'projects:dispatch.runPass': 'Jetzt einen Durchlauf starten',
    'projects:dispatch.agents.title': 'Agenten',
    'projects:dispatch.agents.idleBecause': 'Untätig, weil',
    'projects:dispatch.roles.title': 'Ständige Rollen',
    'projects:dispatch.gates.title': 'Schranken',
    'projects:dispatch.passes.title': 'Letzte Durchläufe',
    'projects:dispatch.gates.hold': 'Schließen',
    'projects:dispatch.gates.open': 'Öffnen',
    'projects:dispatch.idle.model_capacity': 'Sein Modell ist ausgelastet',
    'projects:dispatch.idle.org_limit': 'Alle Agenten-Worker sind belegt',
    'projects:dispatch.idle.unknown': 'Noch kein Durchlauf',
    'projects:dispatch.editor.enabled': 'Arbeitsverteilung ist ein',
    'projects:dispatch.editor.agents': 'Agenten im Pool',
    'projects:dispatch.editor.recheck':
      'Ausgelasteten Host erneut fragen nach (Sekunden)',
    'projects:dispatch.editor.gates.recoverBelow': 'Wieder öffnen unter',
    'tasks:agentRuns.trigger.dispatch': 'Von der Arbeitsverteilung gestartet',
  },
  fr: {
    'projects:dispatch.sources.title': 'Tableaux desservis',
    'projects:dispatch.sources.served': 'Desservi',
    'projects:dispatch.reviewers.title': 'Relecteurs',
    'projects:dispatch.title': 'Répartition du travail',
    'projects:dispatch.edit': 'Modifier',
    'projects:dispatch.runPass': 'Lancer un passage maintenant',
    'projects:dispatch.agents.title': 'Agents',
    'projects:dispatch.agents.idleBecause': 'Inactif, car',
    'projects:dispatch.roles.title': 'Rôles permanents',
    'projects:dispatch.gates.title': 'Barrières',
    'projects:dispatch.passes.title': 'Derniers passages',
    'projects:dispatch.gates.hold': 'Fermer',
    'projects:dispatch.gates.open': 'Ouvrir',
    'projects:dispatch.idle.model_capacity': 'Son modèle est saturé',
    'projects:dispatch.idle.org_limit': 'Tous les workers d’agent sont occupés',
    'projects:dispatch.idle.unknown': 'Aucun passage encore',
    'projects:dispatch.editor.enabled': 'Répartition activée',
    'projects:dispatch.editor.agents': 'Agents du pool',
    'projects:dispatch.editor.recheck':
      'Redemander à un hôte occupé après (secondes)',
    'projects:dispatch.editor.gates.recoverBelow': 'Rouvrir sous',
    'tasks:agentRuns.trigger.dispatch': 'Lancée par la répartition du travail',
  },
} as const;

describe('the Dispatch page in every shipped language', () => {
  it.each(Object.entries(GUIDE_LABELS))(
    'uses the labels its %s guide names',
    (locale, labels) => {
      const tl = i18n.getFixedT(locale);
      for (const [key, label] of Object.entries(labels)) {
        const [ns, path] = key.split(':') as [string, string];
        expect(tl(path, { ns })).toBe(label);
      }
    },
  );

  it('renders the page in German', async () => {
    saveLocale('de');
    answer(readback());
    renderTab();
    const agents = await screen.findByRole('table', {
      name: i18n.t('dispatch.agents.caption', { ns: 'projects' }),
    });
    expect(
      screen.getByRole('button', { name: 'Jetzt einen Durchlauf starten' }),
    ).toBeInTheDocument();
    expect(
      within(rowOf(agents, 'Scribe')).getByText('Keine bereite Arbeit'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Untätig, weil' }),
    ).toBeInTheDocument();
  });
});
