// @vitest-environment node
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { standingWorkerSessionId } from '../../core/sandbox/session_naming.test-helpers.ts';
import type { ProjectAuthContext } from '../projects/service.ts';

const { loadProjectOrThrow } = vi.hoisted(() => ({
  loadProjectOrThrow: vi.fn(),
}));

vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  loadProjectOrThrow,
}));

// After the service: imported first, it leaves the service bound to the
// project service without the mock above.
import {
  getTaskOpsIndicators,
  getTaskOpsIndicatorsForAccessibleProjects,
} from './service.ts';

const auth: ProjectAuthContext = {
  organizationId: 'org-a',
  userId: 'user-ada',
  role: 'owner',
  teamIds: [],
};
const AGENT = '0b7e7a4c-1f7e-4a39-9c55-6f1d3c1f2a10';

interface LiveRunRow {
  runId: string;
  taskId: string;
  agentId: string;
  status: 'queued' | 'running';
  sessionId: string;
  sessionClaimedAt: number | null;
  waitingForCapacityAt: number | null;
  waiting: boolean;
  waitingReason: string | null;
  startedAt: number;
  launchedAt: number | null;
}

function liveRun(n: number, fields: Partial<LiveRunRow> = {}): LiveRunRow {
  return {
    runId: `run-${n}`,
    taskId: `task-${n}`,
    agentId: AGENT,
    status: 'queued',
    sessionId: standingWorkerSessionId(AGENT, 1),
    sessionClaimedAt: null,
    waitingForCapacityAt: null,
    waiting: false,
    waitingReason: null,
    startedAt: n,
    launchedAt: null,
    ...fields,
  };
}

interface AutomationRunRow {
  runId: string;
  taskId: string | null;
  status: 'queued' | 'running' | 'waiting';
  detail: string | null;
  hasPendingAsk: boolean;
}

function automationRun(
  n: number,
  fields: Partial<AutomationRunRow> = {},
): AutomationRunRow {
  return {
    runId: `auto-${n}`,
    taskId: `task-${n}`,
    status: 'running',
    detail: null,
    hasPendingAsk: false,
    ...fields,
  };
}

const FRAGMENT = Symbol('fragment');
interface Fragment {
  [FRAGMENT]: true;
  text: string;
  values: unknown[];
}

function isFragment(value: unknown): value is Fragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [FRAGMENT]?: true })[FRAGMENT] === true
  );
}

/** A SQL tag answering the live-run read with `runs`, the live automation
 * run read with `automationRuns`, the read of tasks with a running agent run
 * with `agentWorkingTaskIds` and every other read with nothing. Nested
 * fragments are inlined the way postgres.js does, and every statement is
 * kept: `reads` holds the live-run reads. */
function opsSql(
  runs: LiveRunRow[],
  automationRuns: AutomationRunRow[] = [],
  agentWorkingTaskIds: string[] = [],
) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const reads: Array<{ text: string; values: unknown[] }> = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    const flat: unknown[] = [];
    strings.forEach((part, index) => {
      text += part;
      if (index >= values.length) return;
      const value = values[index];
      if (isFragment(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += '?';
        flat.push(value);
      }
    });
    text = text.replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values: flat });
    let rows: unknown[] = [];
    if (text.includes('AS "launchedAt"')) {
      reads.push({ text, values: flat });
      const limit = flat.at(-1);
      rows = typeof limit === 'number' ? runs.slice(0, limit) : runs;
    }
    if (text.includes('AS "hasPendingAsk"')) {
      rows = automationRuns;
    }
    if (text.includes('SELECT DISTINCT task_id')) {
      rows = agentWorkingTaskIds.map((taskId) => ({ taskId }));
    }
    const fragment: Fragment = { [FRAGMENT]: true, text, values: flat };
    return Object.assign(Promise.resolve(rows), fragment);
  };
  const sql = Object.assign(tag, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test answers the SQL tag only
  return { sql: sql as unknown as Sql, reads, statements };
}

/** The one project a per-project read joins, as `checkedProjectSql` reads it. */
const CHECKED_PROJECT =
  'JOIN ( SELECT id AS project_id, key AS project_key, archived_at_ms AS project_archived_at_ms FROM app.projects WHERE org_id = ? AND id = ? ) rp';

beforeEach(() => {
  vi.clearAllMocks();
  loadProjectOrThrow.mockResolvedValue({
    id: 'p0',
    organizationId: auth.organizationId,
    teamId: null,
    sharedWithTeamIds: [],
    archivedAt: null,
  });
});

describe('the board reads every live agent run with its worker and wait', () => {
  it('lists running runs first with their worker, then waiting ones with why [TASK-R25]', async () => {
    const { sql, reads } = opsSql([
      liveRun(1, {
        status: 'running',
        sessionId: standingWorkerSessionId(AGENT, 2),
        sessionClaimedAt: 4,
        launchedAt: 5,
      }),
      liveRun(2, {
        waitingForCapacityAt: 6,
        waiting: true,
        waitingReason: 'org_limit',
      }),
      liveRun(3, {
        sessionClaimedAt: 7,
        sessionId: standingWorkerSessionId(AGENT, 3),
      }),
      liveRun(4, {
        waitingForCapacityAt: 8,
        waiting: true,
        waitingReason: null,
      }),
    ]);
    const ops = await getTaskOpsIndicators(sql, auth, 'p0');
    expect(ops.runs).toEqual([
      {
        taskId: 'task-1',
        runId: 'run-1',
        agentId: AGENT,
        status: 'running',
        waiting: false,
        startedAt: 1,
        launchedAt: 5,
        worker: 2,
      },
      {
        taskId: 'task-2',
        runId: 'run-2',
        agentId: AGENT,
        status: 'queued',
        waiting: true,
        waitingReason: 'org_limit',
        startedAt: 2,
      },
      {
        taskId: 'task-3',
        runId: 'run-3',
        agentId: AGENT,
        status: 'queued',
        waiting: false,
        startedAt: 3,
        worker: 3,
      },
      {
        taskId: 'task-4',
        runId: 'run-4',
        agentId: AGENT,
        status: 'queued',
        waiting: true,
        startedAt: 4,
      },
    ]);
    expect(ops.runsTruncated).toBe(false);
    const read = reads[0];
    expect(read?.text).toContain(
      `FROM app.project_agent_runs ${CHECKED_PROJECT} USING (project_id) WHERE org_id = ? AND status IN ('queued', 'running')`,
    );
    expect(read?.text).toContain(
      "ORDER BY (status = 'running') DESC, started_at_ms, seq",
    );
    // Whether a run waits, and why, is read through the predicate every
    // read of a waiting run shares. Loaded here, not at the top: imported
    // ahead of the service, it binds the service to the real project service.
    const { parkedRunSql, parkedWaitingReasonSql } =
      await import('./agent-runs.ts');
    expect(read?.values).toEqual([
      parkedRunSql(),
      parkedWaitingReasonSql(),
      auth.organizationId,
      'p0',
      auth.organizationId,
      51,
    ]);
  });

  it('says when more runs live than the board is sent', async () => {
    const { sql } = opsSql(
      Array.from({ length: 60 }, (_, index) => liveRun(index)),
    );
    const ops = await getTaskOpsIndicators(sql, auth, 'p0');
    expect(ops.runs).toHaveLength(50);
    expect(ops.runsTruncated).toBe(true);
  });

  it('reads the live runs of every project the reader can see at once', async () => {
    const { sql, reads, statements } = opsSql([liveRun(1)]);
    const ops = await getTaskOpsIndicatorsForAccessibleProjects(sql, auth);
    expect(ops.runs.map((run) => run.runId)).toEqual(['run-1']);
    expect(ops.runsTruncated).toBe(false);
    expect(reads).toHaveLength(1);
    // #5156: each read joins the projects the reader may read; none sends
    // an id list back. The relation is one of the recorded fragments.
    const relation = statements.find((s) =>
      s.text.startsWith('( SELECT id AS project_id'),
    );
    expect(relation?.text).toContain('(? OR archived_at_ms IS NULL)');
    expect(relation?.values.slice(0, 3)).toEqual([
      auth.organizationId,
      true,
      false,
    ]);
    const running = statements.find((s) =>
      s.text.startsWith('SELECT DISTINCT task_id'),
    );
    const pending = statements.find((s) =>
      s.text.includes('FROM app.approvals a'),
    );
    expect(running?.text).toContain(
      `FROM app.project_agent_runs JOIN ${relation?.text} rp USING (project_id) WHERE org_id = ? AND status = 'running'`,
    );
    expect(pending?.text).toContain(
      `JOIN ${relation?.text} rp ON rp.project_id = a.metadata ->> 'projectId'`,
    );
    expect(reads[0]?.text).toContain(
      `JOIN ${relation?.text} rp USING (project_id)`,
    );
    for (const read of [running, pending, reads[0]])
      expect(read?.text).not.toContain('ANY(');
    // No project list is read first: the projects are read only inside it.
    for (const statement of statements.filter((s) =>
      s.text.startsWith('SELECT'),
    ))
      expect(statement.text.replaceAll(relation?.text ?? '', '')).not.toContain(
        'FROM app.projects',
      );
  });

  it("reads one project's pending reviews through the project it has checked", async () => {
    const { sql, statements } = opsSql([]);
    await getTaskOpsIndicators(sql, auth, 'p0');
    const pending = statements.find((s) =>
      s.text.includes('FROM app.approvals a'),
    );
    expect(pending?.text).toContain(
      `${CHECKED_PROJECT} ON rp.project_id = a.metadata ->> 'projectId'`,
    );
    expect(pending?.values.slice(0, 2)).toEqual([auth.organizationId, 'p0']);
  });
});

describe('the board reads what a task’s live automation run does', () => {
  it('reads a run as working only while it works, and says what a waiting one waits on', async () => {
    const { sql } = opsSql(
      [],
      [
        automationRun(1),
        automationRun(2, { status: 'waiting', detail: 'agent:write' }),
        automationRun(3, {
          status: 'waiting',
          detail: 'agent:write',
          hasPendingAsk: true,
        }),
        automationRun(4, { status: 'queued' }),
        automationRun(5, { status: 'waiting', detail: 'approval:publish' }),
        automationRun(6, { status: 'waiting', detail: 'room:write' }),
        automationRun(7, { status: 'waiting', detail: 'repeat:poll' }),
        automationRun(8, { status: 'waiting', detail: 'in_doubt:send' }),
        automationRun(9, { status: 'waiting', detail: null }),
      ],
    );
    const ops = await getTaskOpsIndicators(sql, auth, 'p0');
    expect(ops.runningTaskIds).toEqual(['task-1', 'task-2', 'task-3']);
    expect(ops.askingTaskIds).toEqual(['task-3']);
    expect(ops.automationWaits).toEqual([
      { taskId: 'task-4', runId: 'auto-4', status: 'queued' },
      {
        taskId: 'task-5',
        runId: 'auto-5',
        status: 'waiting',
        waitingFor: 'approval',
      },
      {
        taskId: 'task-6',
        runId: 'auto-6',
        status: 'waiting',
        waitingFor: 'room',
      },
      {
        taskId: 'task-7',
        runId: 'auto-7',
        status: 'waiting',
        waitingFor: 'repeat',
      },
      {
        taskId: 'task-8',
        runId: 'auto-8',
        status: 'waiting',
        waitingFor: 'in_doubt',
      },
      { taskId: 'task-9', runId: 'auto-9', status: 'waiting' },
    ]);
  });

  it('reads each task by its newest automation run, after its running agent run', async () => {
    const { sql } = opsSql(
      [],
      [
        automationRun(1, { taskId: 'task-a', status: 'queued' }),
        automationRun(2, { taskId: 'task-a' }),
        automationRun(3, { taskId: 'task-b' }),
        automationRun(4, { taskId: 'task-b', status: 'queued' }),
        automationRun(5, { taskId: 'task-c', status: 'queued' }),
        automationRun(6, { taskId: null, status: 'queued' }),
      ],
      ['task-c'],
    );
    const ops = await getTaskOpsIndicators(sql, auth, 'p0');
    expect(ops.runningTaskIds).toEqual(['task-c', 'task-b']);
    expect(ops.automationWaits).toEqual([
      { taskId: 'task-a', runId: 'auto-1', status: 'queued' },
    ]);
  });

  it('keeps fifty tasks of each kind', async () => {
    const { sql } = opsSql(
      [],
      Array.from({ length: 120 }, (_, index) =>
        automationRun(index, {
          status: index % 2 === 0 ? 'running' : 'queued',
        }),
      ),
    );
    const ops = await getTaskOpsIndicators(sql, auth, 'p0');
    expect(ops.runningTaskIds).toHaveLength(50);
    expect(ops.automationWaits).toHaveLength(50);
    expect(ops.automationRunsTruncated).toBe(true);
  });

  it('says when it leaves live automation runs out of its lists [TASK-R87]', async () => {
    const truncated = async (
      automationRuns: AutomationRunRow[],
      agentWorkingTaskIds: string[] = [],
    ) => {
      const { sql } = opsSql([], automationRuns, agentWorkingTaskIds);
      const ops = await getTaskOpsIndicators(sql, auth, 'p0');
      return ops.automationRunsTruncated;
    };
    const mixed = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        automationRun(index, {
          status: index % 2 === 0 ? 'running' : 'queued',
        }),
      );
    const all = (count: number, fields: Partial<AutomationRunRow> = {}) =>
      Array.from({ length: count }, (_, index) => automationRun(index, fields));
    // As many runs as it scans, each of a task of its own, and fifty of
    // each kind: every one is listed.
    expect(await truncated(mixed(100))).toBe(false);
    expect(await truncated([])).toBe(false);
    // One more than it scans.
    expect(await truncated(mixed(101))).toBe(true);
    // A fifty-first working run, or a fifty-first waiting one.
    expect(await truncated(all(51))).toBe(true);
    expect(await truncated(all(51, { status: 'queued' }))).toBe(true);
    // An older live run of a task its newer run stands for.
    expect(
      await truncated([
        automationRun(1),
        automationRun(2, { taskId: 'task-1', status: 'queued' }),
      ]),
    ).toBe(true);
    // The run of a task whose agent run works.
    expect(
      await truncated([automationRun(1, { status: 'queued' })], ['task-1']),
    ).toBe(true);
  });

  it('scans one live automation run more than it reads, to know of more [TASK-R87]', async () => {
    const { sql, statements } = opsSql([], []);
    await getTaskOpsIndicators(sql, auth, 'p0');
    const scan = statements.find((s) => s.text.includes('AS "hasPendingAsk"'));
    expect(scan?.text).toContain('ORDER BY r.started_at_ms DESC LIMIT ?');
    expect(scan?.values.at(-1)).toBe(101);
  });

  it('reads no automation run across every project', async () => {
    const { sql } = opsSql([], [automationRun(1, { status: 'queued' })]);
    const ops = await getTaskOpsIndicatorsForAccessibleProjects(sql, auth);
    expect(ops.runningTaskIds).toEqual([]);
    expect(ops.automationWaits).toEqual([]);
  });
});
