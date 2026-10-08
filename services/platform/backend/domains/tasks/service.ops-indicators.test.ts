// @vitest-environment node
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { standingWorkerSessionId } from '../../core/sandbox/session_naming.ts';
import type { ProjectAuthContext } from '../projects/service.ts';

const { loadProjectOrThrow, listProjects } = vi.hoisted(() => ({
  loadProjectOrThrow: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  loadProjectOrThrow,
  listProjects,
}));

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
  claimed: boolean;
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
    claimed: false,
    waiting: false,
    waitingReason: null,
    startedAt: n,
    launchedAt: null,
    ...fields,
  };
}

/** A SQL tag answering the live-run read with `runs` and every other read
 * with nothing; the live-run read's text and values are kept. */
function opsSql(runs: LiveRunRow[]) {
  const reads: Array<{ text: string; values: unknown[] }> = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    if (text.includes('AS "launchedAt"')) {
      reads.push({ text, values });
      const limit = values.at(-1);
      return Promise.resolve(
        typeof limit === 'number' ? runs.slice(0, limit) : runs,
      );
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test answers the SQL tag only
  return { sql: sql as unknown as Sql, reads };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadProjectOrThrow.mockResolvedValue({
    id: 'p0',
    organizationId: auth.organizationId,
    teamId: null,
    sharedWithTeamIds: [],
    archivedAt: null,
  });
  listProjects.mockResolvedValue([{ id: 'p0' }, { id: 'p1' }]);
});

describe('the board reads every live agent run with its worker and wait', () => {
  it('lists running runs first with their worker, then waiting ones with why [TASK-R25]', async () => {
    const { sql, reads } = opsSql([
      liveRun(1, {
        status: 'running',
        sessionId: standingWorkerSessionId(AGENT, 2),
        claimed: true,
        launchedAt: 5,
      }),
      liveRun(2, {
        waiting: true,
        waitingReason: 'org_limit',
        // A reason kept on a row a wake restarted is never shown.
      }),
      liveRun(3, {
        claimed: true,
        sessionId: standingWorkerSessionId(AGENT, 3),
      }),
      liveRun(4, { waiting: true, waitingReason: null }),
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
    expect(read?.text).toContain('org_id = ? AND project_id = ANY(?)');
    expect(read?.text).toContain(
      "ORDER BY (status = 'running') DESC, started_at_ms, seq",
    );
    expect(read?.values).toEqual([auth.organizationId, ['p0'], 51]);
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
    const { sql, reads } = opsSql([liveRun(1)]);
    const ops = await getTaskOpsIndicatorsForAccessibleProjects(sql, auth);
    expect(ops.runs.map((run) => run.runId)).toEqual(['run-1']);
    expect(ops.runsTruncated).toBe(false);
    expect(reads).toHaveLength(1);
    expect(reads[0]?.values[1]).toEqual(['p0', 'p1']);
  });
});
