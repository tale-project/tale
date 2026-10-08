import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  memberWorkerSessionId,
  standingWorkerSessionId,
} from '../../core/sandbox/session_naming.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import {
  agentRunWorkDeadline,
  chooseWorker,
  claimAgentWorker,
  parkAgentRunInTx,
  predictWorkerWait,
  type FamilyWorker,
  type WorkerFacts,
} from './agent-workers.ts';
import { sessionIdForAgentRun } from './run-authority.ts';

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(),
}));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('./run-authority.ts', () => ({ sessionIdForAgentRun: vi.fn() }));

const AGENT = '0b7e7a4c-1f7e-4a39-9c55-6f1d3c1f2a10';
const w = (n: number) => standingWorkerSessionId(AGENT, n);
const HOUR = 60 * 60 * 1000;

function worker(
  n: number,
  state: Partial<Omit<FamilyWorker, 'sessionId' | 'worker'>> = {},
): FamilyWorker {
  return {
    sessionId: w(n),
    worker: n,
    warm: false,
    destroyPending: false,
    ...state,
  };
}

function facts(overrides: Partial<WorkerFacts> = {}): WorkerFacts {
  return {
    agentId: AGENT,
    taskId: 'task-release-notes',
    base: w(1),
    occupied: new Set(),
    workers: [],
    heldFor: new Map(),
    room: 2,
    ...overrides,
  };
}

describe('which worker a run starts in', () => {
  it('gives the second task of one agent another worker [TASK-R24]', () => {
    // Scribe works "Changelog" in worker 1; Ada starts it on "Release notes".
    expect(
      chooseWorker(
        facts({
          occupied: new Set([w(1)]),
          workers: [worker(1, { warm: true })],
          room: 1,
        }),
      ),
    ).toEqual({ sessionId: w(2), worker: 2 });
  });

  it("goes back to the task's previous worker when it is free [TASK-R27]", () => {
    expect(
      chooseWorker(
        facts({
          workers: [worker(1, { warm: true }), worker(2)],
          previous: w(2),
        }),
      ),
    ).toEqual({ sessionId: w(2), worker: 2 });
  });

  it('starts fresh on another worker when the previous one is busy [TASK-R27]', () => {
    expect(
      chooseWorker(
        facts({
          occupied: new Set([w(2)]),
          workers: [worker(1), worker(2, { warm: true })],
          previous: w(2),
        }),
      ),
    ).toEqual({ sessionId: w(1), worker: 1 });
  });

  it('takes a stopped worker before it opens a new one [SBX-R19]', () => {
    // Workers 1 and 2 are stopped: the run works in worker 1, no worker 3.
    expect(
      chooseWorker(facts({ workers: [worker(2), worker(1)], room: 2 })),
    ).toEqual({ sessionId: w(1), worker: 1 });
  });

  it('takes a worker that is still up before a stopped one [SBX-R19]', () => {
    expect(
      chooseWorker(facts({ workers: [worker(1), worker(2, { warm: true })] })),
    ).toEqual({ sessionId: w(2), worker: 2 });
  });

  it('opens the lowest free number, worker 1 again once it is gone [SBX-R19]', () => {
    expect(chooseWorker(facts({ workers: [] }))).toEqual({
      sessionId: w(1),
      worker: 1,
    });
    expect(
      chooseWorker(
        facts({
          occupied: new Set([w(1), w(3)]),
          workers: [worker(1, { warm: true }), worker(3, { warm: true })],
        }),
      ),
    ).toEqual({ sessionId: w(2), worker: 2 });
  });

  it('waits for a Destroy rather than opening a worker beside it [SBX-R19]', () => {
    expect(
      chooseWorker(facts({ workers: [worker(1, { destroyPending: true })] })),
    ).toEqual({ wait: 'destroy_pending' });
  });

  it('opens and wakes no worker the organization has no slot for [SBX-R17]', () => {
    // Every slot is held: a stopped worker would need one, a new one too.
    expect(
      chooseWorker(
        facts({ occupied: new Set([w(1)]), workers: [worker(2)], room: 0 }),
      ),
    ).toEqual({ wait: 'org_limit' });
    // A worker that is still up needs no slot of its own.
    expect(
      chooseWorker(facts({ workers: [worker(1, { warm: true })], room: 0 })),
    ).toEqual({ sessionId: w(1), worker: 1 });
  });

  it("keeps a failed run's worker for its task's retry [TASK-R27]", () => {
    const held = facts({
      workers: [worker(1)],
      heldFor: new Map([[w(1), 'task-changelog']]),
      room: 1,
    });
    // Another task opens a worker of its own rather than taking it.
    expect(chooseWorker(held)).toEqual({ sessionId: w(2), worker: 2 });
    // The retry of that task goes back to it.
    expect(
      chooseWorker({ ...held, taskId: 'task-changelog', previous: w(1) }),
    ).toEqual({ sessionId: w(1), worker: 1 });
    // With no slot left, a warm kept worker is the last resort.
    expect(
      chooseWorker({
        ...held,
        workers: [worker(1, { warm: true })],
        room: 0,
      }),
    ).toEqual({ sessionId: w(1), worker: 1 });
  });

  it('keeps the worker a recovered start had already claimed', () => {
    expect(
      chooseWorker(
        facts({
          claimed: w(3),
          workers: [worker(1, { warm: true }), worker(3)],
        }),
      ),
    ).toEqual({ sessionId: w(3), worker: 3 });
  });

  it("names a member's workers within the member's family [SBX-R20]", () => {
    const base = memberWorkerSessionId(AGENT, 'user-mia', 1);
    expect(
      chooseWorker(
        facts({
          base,
          occupied: new Set([base]),
          workers: [
            { sessionId: base, worker: 1, warm: true, destroyPending: false },
          ],
        }),
      ),
    ).toEqual({
      sessionId: memberWorkerSessionId(AGENT, 'user-mia', 2),
      worker: 2,
    });
  });
});

describe('the deadline a run works to [TASK-R25]', () => {
  const kickedAt = 1_000 * HOUR;
  const run = {
    startedAt: kickedAt,
    deadlineAt: kickedAt + 12 * HOUR,
    launchedAt: null,
  };

  it('gives a run that waited its full working time from its start', () => {
    expect(agentRunWorkDeadline(run, kickedAt + 10 * HOUR)).toBe(
      kickedAt + 22 * HOUR,
    );
  });

  it('never moves the deadline earlier, nor past a day after the kick', () => {
    expect(agentRunWorkDeadline(run, kickedAt)).toBe(kickedAt + 12 * HOUR);
    expect(agentRunWorkDeadline(run, kickedAt + 13 * HOUR)).toBe(
      kickedAt + 24 * HOUR,
    );
  });

  it('keeps the deadline of a run that has launched', () => {
    expect(
      agentRunWorkDeadline(
        { ...run, launchedAt: kickedAt + HOUR },
        kickedAt + 10 * HOUR,
      ),
    ).toBe(kickedAt + 12 * HOUR);
  });
});

interface Statement {
  text: string;
  values: unknown[];
}

/** A postgres.js stand-in: every statement is recorded and answered by the
 * first matcher its whitespace-collapsed text contains. */
function fakeSql(answers: Array<[string, unknown[]]>): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    const hit = answers.find(([match]) => text.includes(match));
    return Promise.resolve(hit?.[1] ?? []);
  };
  const sql = Object.assign(tag, {
    begin: (work: (tx: TransactionSql) => Promise<unknown>) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag is the transaction too
      work(tag as unknown as TransactionSql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, statements };
}

const ARGS = { organizationId: 'org-1', runId: 'run-1', execId: 'exec-1' };
const RUN_ROW = {
  agentId: AGENT,
  taskId: 'task-release-notes',
  projectId: 'project-1',
  startedBy: 'user:user-ada',
  sessionId: w(1),
  claimedAt: null,
};
const AGENT_LOCK = "hashtextextended('agent-workers:' ||";
const ORG_LOCK = "hashtextextended('sandbox:' ||";
const RUN = 'AS "claimedAt"';
const FAMILY = 'SELECT DISTINCT ON (session_id) session_id AS "sessionId"';
const OTHERS =
  'SELECT session_id AS "sessionId" FROM app.project_agent_runs WHERE org_id = ? AND agent_id = ?';
const IN_FLIGHT = 'SELECT owner_type AS "ownerType"';
const CLAIM = 'SET session_id = ?, session_claimed_at_ms = ?';
const PARK = "SET status = 'queued'";

function claimSql(
  script: {
    /** The run row, with the fields only some reads take. */
    run?: Partial<typeof RUN_ROW> & {
      status?: string;
      parked?: boolean;
      reason?: string | null;
    };
    family?: Array<{ sessionId: string; status: string; pinned: boolean }>;
    others?: string[];
    inFlight?: number;
  } = {},
) {
  return fakeSql([
    ['SELECT agent_id AS "agentId" FROM', [{ agentId: AGENT }]],
    [RUN, [{ ...RUN_ROW, ...script.run }]],
    [FAMILY, script.family ?? []],
    [OTHERS, (script.others ?? []).map((sessionId) => ({ sessionId }))],
    [
      IN_FLIGHT,
      Array.from({ length: script.inFlight ?? 0 }, () => ({
        ownerType: 'project_agent',
      })),
    ],
    ['SELECT count(*)::int AS count', [{ count: 0 }]],
    [
      PARK,
      [
        {
          organizationId: 'org-1',
          taskId: 'task-release-notes',
          agentId: AGENT,
          execId: 'exec-1',
          sessionId: w(1),
        },
      ],
    ],
  ]);
}

describe('claiming a worker', () => {
  beforeEach(() => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue(null);
    vi.mocked(sessionIdForAgentRun).mockReset();
    vi.mocked(sessionIdForAgentRun).mockResolvedValue(w(1));
  });

  it("takes the agent's lock, then the organization's, then the run", async () => {
    const { sql, statements } = claimSql();
    await claimAgentWorker(sql, ARGS);
    const order = [AGENT_LOCK, ORG_LOCK, RUN].map((match) =>
      statements.findIndex((statement) => statement.text.includes(match)),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The run is read under its row lock, and only while it is queued
    // under this exec and not parked.
    const run = statements.find((statement) => statement.text.includes(RUN));
    expect(run?.text).toContain("status = 'queued' AND exec_id = ?");
    expect(run?.text).toContain('waiting_for_capacity_at_ms IS NULL');
    expect(run?.text).toContain('FOR UPDATE');
  });

  it('stands down for a run that is no longer queued under its exec, or parked', async () => {
    const { sql, statements } = fakeSql([
      ['SELECT agent_id AS "agentId" FROM', [{ agentId: AGENT }]],
    ]);
    await expect(claimAgentWorker(sql, ARGS)).resolves.toBeNull();
    expect(statements.some((s) => s.text.includes(CLAIM))).toBe(false);
  });

  it('writes the worker it chose into the run with the claim stamp [TASK-R24]', async () => {
    const { sql, statements } = claimSql({
      family: [{ sessionId: w(1), status: 'active', pinned: false }],
      others: [w(1)],
      inFlight: 1,
    });
    await expect(claimAgentWorker(sql, ARGS)).resolves.toEqual({
      sessionId: w(2),
      worker: 2,
      moved: true,
    });
    const claim = statements.find((s) => s.text.includes(CLAIM));
    expect(claim?.values[0]).toBe(w(2));
    expect(claim?.text).toContain('waiting_reason = NULL');
    // The card follows its run onto the worker.
    expect(
      statements.some((s) =>
        s.text.includes('INSERT INTO app_realtime.outbox'),
      ),
    ).toBe(true);
  });

  it('parks the run as waiting for a worker when every slot is held [TASK-R25]', async () => {
    const { sql, statements } = claimSql({
      family: [{ sessionId: w(1), status: 'active', pinned: false }],
      others: [w(1)],
      inFlight: 2,
    });
    await expect(claimAgentWorker(sql, ARGS)).resolves.toEqual({
      parked: 'org_limit',
    });
    const park = statements.find((s) => s.text.includes(PARK));
    expect(park?.text).toContain('waiting_reason = ?');
    expect(park?.text).toContain('session_claimed_at_ms = NULL');
    expect(park?.values).toContain('org_limit');
    expect(statements.some((s) => s.text.includes(CLAIM))).toBe(false);
  });

  it("moves a run whose starter lost the editor role into the member's family [SBX-R20]", async () => {
    const member = memberWorkerSessionId(AGENT, 'user-ada', 1);
    vi.mocked(sessionIdForAgentRun).mockResolvedValue(member);
    const { sql } = claimSql({
      family: [{ sessionId: w(1), status: 'stopped', pinned: false }],
    });
    await expect(claimAgentWorker(sql, ARGS)).resolves.toEqual({
      sessionId: member,
      worker: 1,
      moved: true,
    });
  });

  it('never moves a member run into the standing family [SBX-R20]', async () => {
    const member = memberWorkerSessionId(AGENT, 'user-mia', 1);
    const { sql } = claimSql({
      run: { sessionId: member },
      family: [{ sessionId: w(1), status: 'active', pinned: false }],
    });
    await expect(claimAgentWorker(sql, ARGS)).resolves.toMatchObject({
      sessionId: member,
    });
    expect(sessionIdForAgentRun).not.toHaveBeenCalled();
  });

  it('reads again when the schema refuses a second run on one worker', async () => {
    const { sql } = claimSql({});
    const begin = vi.spyOn(sql, 'begin');
    begin.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error('duplicate'), { code: '23505' })),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(claimAgentWorker(sql, ARGS)).resolves.toMatchObject({
      worker: 1,
    });
    expect(begin).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('parking a run that found no room [TASK-R25]', () => {
  it('keeps why it waits and gives its worker back', async () => {
    const { sql, statements } = fakeSql([
      [
        PARK,
        [
          {
            organizationId: 'org-1',
            taskId: 'task-1',
            agentId: AGENT,
            execId: 'exec-1',
            sessionId: w(2),
          },
        ],
      ],
    ]);
    await sql.begin((tx) =>
      parkAgentRunInTx(tx, {
        runId: 'run-1',
        execId: 'exec-1',
        reason: 'host',
      }),
    );
    const park = statements.find((s) => s.text.includes(PARK));
    expect(park?.values).toContain('host');
    expect(park?.text).toContain('session_claimed_at_ms = NULL');
    // A parked run names its family's first worker again.
    const back = statements.find((s) =>
      s.text.startsWith('UPDATE app.project_agent_runs SET session_id = ?'),
    );
    expect(back?.values[0]).toBe(w(1));
  });
});

describe('telling a start whether its run waits [TASK-R26]', () => {
  const PREDICT = { organizationId: 'org-1', runId: 'run-1' };
  const QUEUED = { status: 'queued', parked: false, reason: null };

  beforeEach(() => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue(null);
    vi.mocked(sessionIdForAgentRun).mockReset();
    vi.mocked(sessionIdForAgentRun).mockResolvedValue(w(1));
  });

  it('says the run waits for a worker when every slot is held, and takes nothing', async () => {
    const { sql, statements } = claimSql({
      run: QUEUED,
      family: [{ sessionId: w(1), status: 'active', pinned: false }],
      others: [w(1)],
      inFlight: 2,
    });
    await expect(predictWorkerWait(sql, PREDICT)).resolves.toBe('org_limit');
    for (const write of [AGENT_LOCK, ORG_LOCK, CLAIM, PARK, 'FOR UPDATE']) {
      expect(statements.some((s) => s.text.includes(write))).toBe(false);
    }
  });

  it('says nothing for a run that would find a worker', async () => {
    const { sql } = claimSql({
      run: QUEUED,
      family: [{ sessionId: w(1), status: 'active', pinned: false }],
      others: [w(1)],
      inFlight: 1,
    });
    await expect(predictWorkerWait(sql, PREDICT)).resolves.toBeNull();
  });

  it('repeats the reason of a run already parked, and nothing for one at work', async () => {
    const parked = claimSql({
      run: { status: 'queued', parked: true, reason: 'host' },
    });
    await expect(predictWorkerWait(parked.sql, PREDICT)).resolves.toBe('host');
    const running = claimSql({ run: { ...QUEUED, status: 'running' } });
    await expect(predictWorkerWait(running.sql, PREDICT)).resolves.toBeNull();
  });
});
