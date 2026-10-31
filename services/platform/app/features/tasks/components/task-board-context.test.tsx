import { describe, expect, it } from 'vitest';

import type {
  TaskOpsAutomationWaitIndicator,
  TaskOpsRunIndicator,
} from '@/app/lib/backend/contract/tasks';
import { render, screen } from '@/tests/utils/render';

import type { TaskDoc } from '../lib/display';
import {
  isRunLive,
  readLiveRuns,
  TaskBoardProvider,
  type TaskRunState,
  useTaskBoardContext,
} from './task-board-context';

function row(id: string, fields: Partial<TaskDoc> = {}): TaskDoc {
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
    assigneeType: 'agent',
    assigneeId: 'agent-1',
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
    agentId: 'agent-1',
    status: 'queued',
    waiting: false,
    startedAt: 0,
    ...fields,
  };
}

function States({ ids }: { ids: readonly string[] }) {
  const { runState } = useTaskBoardContext();
  return (
    <output>
      {JSON.stringify(Object.fromEntries(ids.map((id) => [id, runState(id)])))}
    </output>
  );
}

/** Each task's run state as the board reads it. */
function readStates(
  tasks: readonly TaskDoc[],
  indicators: {
    running?: string[];
    asking?: string[];
    runs?: TaskOpsRunIndicator[];
    runsTruncated?: boolean;
    automationWaits?: TaskOpsAutomationWaitIndicator[];
  },
): Record<string, TaskRunState | undefined> {
  const { unmount } = render(
    <TaskBoardProvider
      tasks={tasks}
      dependencyEdges={[]}
      runningTaskIds={indicators.running}
      askingTaskIds={indicators.asking}
      runs={indicators.runs}
      runsTruncated={indicators.runsTruncated}
      automationWaits={indicators.automationWaits}
    >
      <States ids={tasks.map((task) => task._id)} />
    </TaskBoardProvider>,
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the JSON `States` just wrote
  const states = JSON.parse(
    screen.getByRole('status').textContent ?? '{}',
  ) as Record<string, TaskRunState>;
  unmount();
  return states;
}

describe('the board’s one reading of a task’s live run', () => {
  it('says what each run does, the most telling state first', () => {
    const tasks = [
      'asks',
      'works',
      'runs',
      'parked',
      'why',
      'queued',
      'auto',
    ].map((id) => row(id));
    expect(
      readStates(tasks, {
        running: ['asks', 'works'],
        asking: ['asks'],
        runs: [
          run('runs', { status: 'running' }),
          // A task's working run wins over its queued one.
          run('works', { waiting: true, waitingReason: 'host' }),
          run('parked', { waiting: true }),
          run('why', { waiting: true, waitingReason: 'model_capacity' }),
          run('queued'),
          run('auto'),
        ],
        automationWaits: [
          { taskId: 'auto', runId: 'auto-1', status: 'waiting' },
        ],
      }),
    ).toEqual({
      asks: { kind: 'asking' },
      works: { kind: 'working' },
      runs: { kind: 'working' },
      parked: { kind: 'waiting' },
      why: { kind: 'waiting', reason: 'model_capacity' },
      queued: { kind: 'queued' },
      auto: { kind: 'queued' },
    });
  });

  it('reads an automation run that waits as waiting, never working', () => {
    const tasks = ['approval', 'room', 'unparked', 'queued'].map((id) =>
      row(id),
    );
    expect(
      readStates(tasks, {
        automationWaits: [
          {
            taskId: 'approval',
            runId: 'a',
            status: 'waiting',
            waitingFor: 'approval',
          },
          { taskId: 'room', runId: 'b', status: 'waiting', waitingFor: 'room' },
          { taskId: 'unparked', runId: 'c', status: 'waiting' },
          { taskId: 'queued', runId: 'd', status: 'queued' },
        ],
      }),
    ).toEqual({
      approval: { kind: 'automationWaiting', waitingFor: 'approval' },
      room: { kind: 'automationWaiting', waitingFor: 'room' },
      unparked: { kind: 'automationWaiting' },
      queued: { kind: 'queued' },
    });
  });

  it('reads an unlisted agent task In progress as unknown while the list is truncated', () => {
    const tasks = [
      row('hidden'),
      row('listed'),
      row('todo', { status: 'todo' }),
      row('person', { assigneeType: 'user', assigneeId: 'ava' }),
    ];
    expect(
      readStates(tasks, {
        runs: [run('listed', { waiting: true })],
        runsTruncated: true,
      }),
    ).toEqual({
      hidden: { kind: 'unknown' },
      listed: { kind: 'waiting' },
    });
    // A complete list tells an idle task.
    expect(readStates(tasks, { runs: [], runsTruncated: false })).toEqual({});
  });

  it('counts only a known run as live', () => {
    expect(isRunLive(undefined)).toBe(false);
    expect(isRunLive({ kind: 'unknown' })).toBe(false);
    for (const kind of ['asking', 'working', 'waiting', 'queued'] as const) {
      expect(isRunLive({ kind })).toBe(true);
    }
    expect(isRunLive({ kind: 'automationWaiting' })).toBe(true);
  });
});

describe('the live runs the board counts', () => {
  it('lists each live run once, and two runs of one task as two [TASK-R87]', () => {
    expect(
      readLiveRuns({
        runningTaskIds: ['works', 'both', 'asks', 'unlisted'],
        askingTaskIds: ['asks'],
        runs: [
          // A working agent run is listed, and named in `runningTaskIds`.
          run('works', { status: 'running' }),
          run('works', {
            runId: 'run-works-2',
            agentId: 'agent-2',
            status: 'running',
          }),
          run('both'),
        ],
        automationWaits: [
          {
            taskId: 'waits',
            runId: 'auto-1',
            status: 'waiting',
            waitingFor: 'room',
          },
        ],
      }),
    ).toEqual([
      {
        taskId: 'works',
        runId: 'run-works',
        agentId: 'agent-1',
        state: { kind: 'working' },
      },
      {
        taskId: 'works',
        runId: 'run-works-2',
        agentId: 'agent-2',
        state: { kind: 'working' },
      },
      {
        taskId: 'both',
        runId: 'run-both',
        agentId: 'agent-1',
        state: { kind: 'queued' },
      },
      // An automation run's question: once, though it is also running.
      { taskId: 'asks', state: { kind: 'asking' } },
      // The automation run beside the task's queued agent run.
      { taskId: 'both', state: { kind: 'working' } },
      // A working run the capped list of agent runs leaves out.
      { taskId: 'unlisted', state: { kind: 'working' } },
      {
        taskId: 'waits',
        runId: 'auto-1',
        state: { kind: 'automationWaiting', waitingFor: 'room' },
      },
    ]);
  });

  it('lists none for an empty or absent read [TASK-R87]', () => {
    expect(
      readLiveRuns({
        runningTaskIds: [],
        askingTaskIds: [],
        runs: [],
        automationWaits: [],
      }),
    ).toEqual([]);
    expect(readLiveRuns({})).toEqual([]);
  });
});
