import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  TaskOpsAutomationWaitIndicator,
  TaskOpsRunIndicator,
} from '@/app/lib/backend/contract/tasks';
import { render, screen, within } from '@/tests/utils/render';

import type { BoardReadState } from '../lib/read-state';
import { AgentActivitySummary } from './agent-activity-summary';
import type { TaskRow } from './task-card';

function row(id: string, fields: Partial<TaskRow> = {}): TaskRow {
  return {
    _id: id,
    _creationTime: 0,
    organizationId: 'org',
    projectId: 'project',
    title: id,
    status: 'in_progress',
    rank: 'a0',
    number: 1,
    createdBy: 'owner',
    createdByType: 'user',
    createdAt: 0,
    updatedAt: 0,
    ...fields,
  };
}

function run(
  taskId: string,
  fields: Partial<TaskOpsRunIndicator> = {},
): TaskOpsRunIndicator {
  return {
    taskId,
    runId: `run-${taskId}`,
    agentId: 'scribe',
    status: 'queued',
    waiting: false,
    startedAt: 0,
    ...fields,
  };
}

const AGENTS: Record<string, string> = { scribe: 'Scribe', coder: 'Coder' };

// An implementation In progress, a standing role whose run works while its
// task stays in To do, and an In progress card whose run ended long ago.
const IMPLEMENTATION = row('impl', {
  number: 12,
  title: 'Ship the importer',
});
const STANDING = row('triage', { number: 3, title: 'Triage', status: 'todo' });
const STALE = row('stale', { number: 7, title: 'Press kit' });

function renderSummary({
  read = { kind: 'ready', updating: false },
  running = [],
  asking = [],
  runs = [],
  automationWaits = [],
  partial = false,
  tasks = [IMPLEMENTATION, STANDING, STALE],
}: {
  read?: BoardReadState;
  running?: string[];
  asking?: string[];
  runs?: TaskOpsRunIndicator[];
  automationWaits?: TaskOpsAutomationWaitIndicator[];
  partial?: boolean;
  tasks?: TaskRow[];
}) {
  const onOpenTask = vi.fn();
  const byId = new Map(tasks.map((task) => [task._id, task]));
  const view = render(
    <AgentActivitySummary
      read={read}
      runningTaskIds={running}
      askingTaskIds={asking}
      runs={runs}
      automationWaits={automationWaits}
      partial={partial}
      projectKey="PRJ"
      getTask={(taskId) => byId.get(taskId)}
      agentName={(agentId) => AGENTS[agentId]}
      onOpenTask={onOpenTask}
    />,
  );
  return { ...view, onOpenTask };
}

/** The menu's rows, each with the heading of the group it sits in. */
function rowsUnderHeadings(menu: HTMLElement): [string, HTMLElement][] {
  const rows: [string, HTMLElement][] = [];
  let heading = '';
  for (const child of menu.querySelectorAll<HTMLElement>(':scope > *')) {
    const role = child.getAttribute('role');
    if (role === 'menuitem') rows.push([heading, child]);
    else if (role !== 'separator') heading = child.textContent ?? '';
  }
  return rows;
}

/** Both runs the dispatch started: the implementation's and the standing
 * role's, whose task stays in To do. */
const TWO_AT_WORK = {
  running: ['impl', 'triage'],
  runs: [
    run('impl', { status: 'running' }),
    run('triage', { status: 'running', agentId: 'coder' }),
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the board’s count of the project’s live agent runs', () => {
  it('counts the In progress run and the standing To do run, and moves neither [TASK-R87]', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { user, onOpenTask } = renderSummary(TWO_AT_WORK);

    const button = screen.getByRole('button', {
      name: 'Agent runs: 2 running, in this whole project',
    });
    await user.click(button);
    const menu = await screen.findByRole('menu');
    expect(
      within(menu).getByText(
        "Each live run in this project counts once, whatever the board's search and filters show.",
      ),
    ).toBeInTheDocument();
    const entries = within(menu).getAllByRole('menuitem');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveAccessibleName(
      'PRJ-12, Ship the importer, Scribe is working',
    );
    expect(entries[1]).toHaveAccessibleName('PRJ-3, Triage, Coder is working');

    // Choosing the standing role's run opens its task, nothing more.
    await user.click(entries[1] as HTMLElement);
    expect(onOpenTask).toHaveBeenCalledExactlyOnceWith('triage');
    expect(STANDING.status).toBe('todo');
    expect(IMPLEMENTATION.status).toBe('in_progress');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never counts an In progress card with no live run [TASK-R87]', async () => {
    const { user } = renderSummary({
      running: ['impl'],
      runs: [run('impl', { status: 'running' })],
    });

    await user.click(
      screen.getByRole('button', {
        name: 'Agent runs: 1 running, in this whole project',
      }),
    );
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByText('Press kit')).not.toBeInTheDocument();
  });

  it('sorts each live run into running, waiting for input or queued [TASK-R87]', async () => {
    const { user } = renderSummary({
      // An automation run asking a person is listed as running and asking:
      // it counts once, as waiting for input.
      running: ['ask', 'auto'],
      asking: ['ask'],
      runs: [
        run('queued'),
        run('parked', { waiting: true, waitingReason: 'org_limit' }),
      ],
      automationWaits: [
        {
          taskId: 'approval',
          runId: 'a-1',
          status: 'waiting',
          waitingFor: 'approval',
        },
        {
          taskId: 'doubt',
          runId: 'a-2',
          status: 'waiting',
          waitingFor: 'in_doubt',
        },
        { taskId: 'slot', runId: 'a-3', status: 'waiting', waitingFor: 'room' },
        { taskId: 'later', runId: 'a-4', status: 'queued' },
      ],
      tasks: [],
    });

    await user.click(
      screen.getByRole('button', {
        name: 'Agent runs: 1 running, 3 waiting for input, 4 queued, in this whole project',
      }),
    );
    // Each run once, under the heading of what it does, named with the
    // line its card shows; a run whose task the board can't show says so.
    const rows = rowsUnderHeadings(await screen.findByRole('menu'));
    expect(rows.map(([heading]) => heading)).toEqual([
      'Running',
      'Waiting for input',
      'Waiting for input',
      'Waiting for input',
      'Queued',
      'Queued',
      'Queued',
      'Queued',
    ]);
    const lines = [
      'Agent is working…',
      'Waiting for your answer',
      'Waiting for approval',
      'Waiting for a decision',
      'Queued',
      'Waiting for a worker',
      'Waiting for a sandbox slot',
      'Queued',
    ];
    rows.forEach(([, entry], index) => {
      expect(entry).toHaveAccessibleName(
        `A task this view doesn't show, ${lines[index]}`,
      );
    });
  });

  it('counts the whole project whatever the board shows [TASK-R87]', async () => {
    // The board is filtered down to the implementation alone: the standing
    // role's run still counts, under a task the view doesn't show.
    const { user } = renderSummary({ ...TWO_AT_WORK, tasks: [IMPLEMENTATION] });

    await user.click(
      screen.getByRole('button', {
        name: 'Agent runs: 2 running, in this whole project',
      }),
    );
    const entries = within(await screen.findByRole('menu')).getAllByRole(
      'menuitem',
    );
    expect(entries[1]).toHaveAccessibleName(
      "A task this view doesn't show, Coder is working",
    );
  });

  it('says none only for a read that answered, and a partial count is a floor [TASK-R87]', async () => {
    const empty = renderSummary({});
    expect(
      screen.getByRole('button', {
        name: 'Agent runs: none live, in this whole project',
      }),
    ).toBeInTheDocument();
    empty.unmount();

    const { user } = renderSummary({ ...TWO_AT_WORK, partial: true });
    await user.click(
      screen.getByRole('button', {
        name: 'Agent runs: 2+ running, in this whole project',
      }),
    );
    expect(
      await screen.findByText(
        'Not every live run could be listed, so there may be more than these.',
      ),
    ).toBeInTheDocument();
  });

  it.each([
    ['loading', { kind: 'loading' }, 'loading…'],
    ['failed', { kind: 'failed', retrying: false }, 'unavailable'],
    ['failed and retrying', { kind: 'failed', retrying: true }, 'unavailable'],
    // A refresh that failed keeps its last answer: no longer current, so
    // not counted either.
    ['out of date', { kind: 'stale', retrying: false }, 'unavailable'],
  ] satisfies [string, BoardReadState, string][])(
    'never reads a %s read as no runs [TASK-R87]',
    async (_name, read, state) => {
      const { user } = renderSummary({ ...TWO_AT_WORK, read });

      const button = screen.getByRole('button', {
        name: `Agent runs: ${state}, in this whole project`,
      });
      expect(button).not.toHaveTextContent(/none|\d/);
      await user.click(button);
      expect(
        within(await screen.findByRole('menu')).queryByRole('menuitem'),
      ).not.toBeInTheDocument();
    },
  );

  it('opens from the keyboard and opens the chosen run’s task [TASK-R87]', async () => {
    const { user, onOpenTask } = renderSummary(TWO_AT_WORK);

    await user.tab();
    expect(screen.getByRole('button', { name: /^Agent runs:/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    const entries = within(await screen.findByRole('menu')).getAllByRole(
      'menuitem',
    );
    expect(entries[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(entries[1]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onOpenTask).toHaveBeenCalledExactlyOnceWith('triage');
  });

  it('pulses only while a run works, and not for reduced motion [TASK-R87]', () => {
    const working = renderSummary(TWO_AT_WORK);
    const icon = working.container.querySelector('button svg');
    expect(icon).toHaveClass('animate-pulse', 'motion-reduce:animate-none');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    working.unmount();

    const waiting = renderSummary({ runs: [run('impl')] });
    expect(waiting.container.querySelector('button svg')).not.toHaveClass(
      'animate-pulse',
    );
  });
});
