import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sandboxDevices } from '../../core/node_only/sandbox/helpers/session_client.ts';
import {
  memberWorkerSessionId,
  standingWorkerSessionId,
} from '../../core/sandbox/session_naming.test-helpers.ts';
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
vi.mock('../../core/node_only/sandbox/helpers/session_client.ts', () => ({
  sandboxDevices: vi.fn(),
}));

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

  it('takes a stopped worker before it opens a new one [SBX-R20]', () => {
    // Workers 1 and 2 are stopped: the run works in worker 1, no worker 3.
    expect(
      chooseWorker(facts({ workers: [worker(2), worker(1)], room: 2 })),
    ).toEqual({ sessionId: w(1), worker: 1 });
  });

  it('takes a worker that is still up before a stopped one [SBX-R20]', () => {
    expect(
      chooseWorker(facts({ workers: [worker(1), worker(2, { warm: true })] })),
    ).toEqual({ sessionId: w(2), worker: 2 });
  });

  it('opens the lowest free number, worker 1 again once it is gone [SBX-R20]', () => {
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

  it('waits for a Destroy rather than opening a worker beside it [SBX-R20]', () => {
    expect(
      chooseWorker(facts({ workers: [worker(1, { destroyPending: true })] })),
    ).toEqual({ wait: 'destroy_pending' });
  });

  it('opens and wakes no worker the organization has no slot for [SBX-R18]', () => {
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

  it("names a member's workers within the member's family [SBX-R21]", () => {
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

describe('a run its sandbox host refused [TASK-R85]', () => {
  // Scribe's worker 3 opened on the server while the laptop's two slots
  // were busy, and "Release notes" last worked there. Its next start was
  // refused because the server is full. The laptop has a slot free now.
  const laptop = (placed: string[]) => ({
    room: true,
    workers: new Set(placed),
  });
  const refusedIn3 = {
    previous: w(3),
    refused: new Set([w(3)]),
  };

  it('starts in a stopped worker on a device with room, not in its previous one', () => {
    expect(
      chooseWorker(
        facts({
          ...refusedIn3,
          workers: [worker(2), worker(3)],
          devices: laptop([w(2)]),
        }),
      ),
    ).toEqual({ sessionId: w(2), worker: 2 });
  });

  it('opens a new worker for the device rather than start another one on the full host', () => {
    // Worker 1 is stopped on the server too: starting it asks that host.
    expect(
      chooseWorker(
        facts({
          ...refusedIn3,
          workers: [worker(1), worker(3)],
          devices: laptop([]),
        }),
      ),
    ).toEqual({ sessionId: w(2), worker: 2 });
  });

  it('opens the lowest free number though a host refused it before', () => {
    // Worker 1 was refused, then destroyed: the hub places a new workspace
    // by the room its devices have, whatever its number.
    expect(
      chooseWorker(
        facts({
          previous: w(3),
          refused: new Set([w(1), w(3)]),
          workers: [worker(3)],
          devices: laptop([]),
        }),
      ),
    ).toEqual({ sessionId: w(1), worker: 1 });
  });

  it('takes a worker that is up and was not refused, which needs no host', () => {
    expect(
      chooseWorker(
        facts({
          ...refusedIn3,
          workers: [worker(1, { warm: true }), worker(3)],
        }),
      ),
    ).toEqual({ sessionId: w(1), worker: 1 });
  });

  it('goes back to its previous worker once it is placed on a device with room', () => {
    expect(
      chooseWorker(
        facts({
          ...refusedIn3,
          workers: [worker(2), worker(3)],
          devices: laptop([w(2), w(3)]),
        }),
      ),
    ).toEqual({ sessionId: w(3), worker: 3 });
  });

  it('waits in its previous worker when no device has room, or the hub did not say', () => {
    const onTheServer = { ...refusedIn3, workers: [worker(1), worker(3)] };
    expect(chooseWorker(facts(onTheServer))).toEqual({
      sessionId: w(3),
      worker: 3,
    });
    expect(
      chooseWorker(
        facts({
          ...onTheServer,
          // Worker 1 is on the laptop, which is full too.
          devices: { room: false, workers: new Set() },
        }),
      ),
    ).toEqual({ sessionId: w(3), worker: 3 });
  });

  it('keeps the worker it already claimed, and opens none without a slot', () => {
    const onTheLaptop = {
      ...refusedIn3,
      workers: [worker(2), worker(3)],
      devices: laptop([w(2)]),
    };
    expect(chooseWorker(facts({ ...onTheLaptop, claimed: w(3) }))).toEqual({
      sessionId: w(3),
      worker: 3,
    });
    expect(chooseWorker(facts({ ...onTheLaptop, room: 0 }))).toEqual({
      wait: 'org_limit',
    });
  });

  it('goes back to its previous worker first when no host refused it', () => {
    expect(
      chooseWorker(
        facts({
          previous: w(3),
          workers: [worker(2), worker(3)],
          devices: laptop([w(2)]),
        }),
      ),
    ).toEqual({ sessionId: w(3), worker: 3 });
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
    unsafe: (text: string) => text,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, statements };
}

/** The value a statement passes at the last `?` of `fragment`. */
function valueAt(statement: Statement | undefined, fragment: string): unknown {
  const at = statement?.text.indexOf(fragment) ?? -1;
  if (statement === undefined || at < 0) return undefined;
  const before = statement.text.slice(0, at + fragment.length);
  return statement.values[before.split('?').length - 2];
}

const ARGS = { organizationId: 'org-1', runId: 'run-1', execId: 'exec-1' };
const RUN_ROW = {
  agentId: AGENT,
  taskId: 'task-release-notes',
  projectId: 'project-1',
  startedBy: 'user:user-ada',
  sessionId: w(1),
  claimedAt: null,
  hostRefused: [] as string[],
};
const AGENT_LOCK = "hashtextextended('agent-workers:' ||";
const ORG_LOCK = "hashtextextended('sandbox:' ||";
const RUN = 'AS "claimedAt"';
const FAMILY = 'SELECT DISTINCT ON (session_id) session_id AS "sessionId"';
const OTHERS =
  'SELECT session_id AS "sessionId" FROM app.project_agent_runs WHERE org_id = ? AND agent_id = ?';
const IN_FLIGHT = 'SELECT owner_type AS "ownerType"';
const CLAIM = 'SET session_id = ?, session_claimed_at_ms = ?';
const ROOM = 'AS pending';
const PARK = "SET status = 'queued'";
const ASKS_HUB = 'AS ask';
const PREVIOUS = 'ORDER BY seq DESC';

function claimSql(
  script: {
    /** The run row, with the fields only some reads take. */
    run?: Partial<typeof RUN_ROW> & {
      status?: string;
      parked?: boolean;
      reason?: string | null;
      woken?: boolean;
    };
    family?: Array<{ sessionId: string; status: string; pinned: boolean }>;
    others?: string[];
    inFlight?: number;
    /** Other runs a wake restarted that have not claimed yet. */
    woken?: number;
    /** The worker the task's last launched run worked in. */
    previous?: string;
    /** The run was refused by a host, and its organization has a device. */
    asksHub?: boolean;
  } = {},
) {
  return fakeSql([
    [ASKS_HUB, [{ ask: script.asksHub === true }]],
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
    [ROOM, [{ pending: 0, woken: script.woken ?? 0 }]],
    [
      PREVIOUS,
      script.previous === undefined ? [] : [{ sessionId: script.previous }],
    ],
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

  it('counts as holding a worker only a run that works in it or has claimed it [TASK-R27]', async () => {
    // Ada starts Scribe on "Changelog"; a moment later she asks for changes
    // on "Release notes", which last worked in worker 1. Changelog's kick
    // names worker 1 too, but has not claimed it: Release notes goes back
    // to worker 1, and Changelog takes another once its own claim runs.
    const { sql, statements } = claimSql({
      family: [{ sessionId: w(1), status: 'stopped', pinned: false }],
    });
    await claimAgentWorker(sql, ARGS);
    const others = statements.find((s) => s.text.includes(OTHERS));
    expect(others?.text).toContain(
      "(status = 'running' OR (status = 'queued' AND waiting_for_capacity_at_ms IS NULL AND session_claimed_at_ms IS NOT NULL))",
    );
  });

  it.each([
    ['the runs holding a worker', "(status = 'running'"],
    ['the task’s previous run', 'ORDER BY seq DESC'],
    ['the worker kept for a retry', "r.status IN ('failed', 'cancelled')"],
  ])(
    'looks only at runs of the full workspace when it reads %s: a run without one works in no worker [TASK-R37]',
    async (_label, fragment) => {
      const { sql, statements } = claimSql({
        family: [{ sessionId: w(1), status: 'stopped', pinned: false }],
      });

      await claimAgentWorker(sql, ARGS);

      const read = statements.find((s) => s.text.includes(fragment));
      expect(read?.text).toContain("engine = 'harness'");
    },
  );

  it("moves a run whose starter lost the editor role into the member's family [SBX-R21]", async () => {
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

  it('never moves a member run into the standing family [SBX-R21]', async () => {
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

describe('claiming for a run its sandbox host refused [TASK-R85]', () => {
  // "Release notes" last worked in worker 3, on the server, which refused
  // its start: the server is full. The laptop holds worker 2, stopped, and
  // has a slot free.
  const laptop = (freeSlots: number) => ({
    deviceId: 'laptop',
    connectedAtMs: 5,
    version: '0.5.89',
    compatible: true,
    maxSessions: 2,
    sessions: { running: 2 - freeSlots, starting: 0 },
    resources: null,
    platform: null,
    update: {
      state: 'idle' as const,
      targetVersion: null,
      error: null,
      atMs: null,
    },
    freeSlots,
  });
  const refused = {
    run: { hostRefused: [w(3)] },
    previous: w(3),
    family: [
      { sessionId: w(2), status: 'stopped', pinned: false },
      { sessionId: w(3), status: 'stopped', pinned: false },
    ],
  };

  beforeEach(() => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue(null);
    vi.mocked(sessionIdForAgentRun).mockReset();
    vi.mocked(sessionIdForAgentRun).mockResolvedValue(w(1));
    vi.mocked(sandboxDevices).mockReset();
    vi.mocked(sandboxDevices).mockResolvedValue({
      hub: true,
      devices: [laptop(1)],
      placements: [{ sessionId: w(2), deviceId: 'laptop' }],
    });
  });

  it('asks the hub where a device has room, and starts in the worker placed there', async () => {
    const { sql, statements } = claimSql({ ...refused, asksHub: true });
    await expect(claimAgentWorker(sql, ARGS)).resolves.toEqual({
      sessionId: w(2),
      worker: 2,
      moved: true,
    });
    expect(sandboxDevices).toHaveBeenCalledWith('org-1');
    // The run reads the workers its host refused, and its claim keeps them.
    const run = statements.find((s) => s.text.includes(RUN));
    expect(run?.text).toContain('host_refused_session_ids AS "hostRefused"');
    const claim = statements.find((s) => s.text.includes(CLAIM));
    expect(claim?.text).not.toContain('host_refused_session_ids');
  });

  it('asks the hub only for a refused run of an organization with a device, before any lock', async () => {
    const { sql, statements } = claimSql(refused);
    await expect(claimAgentWorker(sql, ARGS)).resolves.toMatchObject({
      sessionId: w(3),
    });
    expect(sandboxDevices).not.toHaveBeenCalled();
    const ask = statements.findIndex((s) => s.text.includes(ASKS_HUB));
    expect(statements[ask]?.text).toContain(
      'cardinality(r.host_refused_session_ids) > 0',
    );
    expect(statements[ask]?.text).toContain('d.revoked_at_ms IS NULL');
    expect(ask).toBeLessThan(
      statements.findIndex((s) => s.text.includes(AGENT_LOCK)),
    );
  });

  it('starts in its previous worker when no device has room', async () => {
    vi.mocked(sandboxDevices).mockResolvedValue({
      hub: true,
      devices: [laptop(0)],
      placements: [{ sessionId: w(2), deviceId: 'laptop' }],
    });
    const { sql } = claimSql({ ...refused, asksHub: true });
    await expect(claimAgentWorker(sql, ARGS)).resolves.toMatchObject({
      sessionId: w(3),
    });
  });

  it('claims as before when the hub does not answer', async () => {
    vi.mocked(sandboxDevices).mockRejectedValue(
      new Error('Sandbox devices unavailable (502)'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sql } = claimSql({ ...refused, asksHub: true });
    await expect(claimAgentWorker(sql, ARGS)).resolves.toMatchObject({
      sessionId: w(3),
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('device room for run run-1 unavailable'),
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it('tells a start whether it waits without asking the hub', async () => {
    const { sql } = claimSql({
      ...refused,
      run: { ...refused.run, status: 'queued', parked: false, reason: null },
      asksHub: true,
    });
    await expect(
      predictWorkerWait(sql, { organizationId: 'org-1', runId: 'run-1' }),
    ).resolves.toBeNull();
    expect(sandboxDevices).not.toHaveBeenCalled();
  });
});

describe('a start that has not waited and a run woken for room [TASK-R25]', () => {
  beforeEach(() => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue(null);
    vi.mocked(sessionIdForAgentRun).mockReset();
    vi.mocked(sessionIdForAgentRun).mockResolvedValue(w(1));
  });

  it('waits behind a woken run rather than take the room its wake found', async () => {
    // Scribe's worker 1 stopped when "Changelog" finished, and the wake
    // chose Lector's waiting run for the freed slot. A manager starts
    // Scribe on "Press kit" before Lector's run has claimed: worker 1 is
    // free, but starting it would take Lector's slot.
    const { sql, statements } = claimSql({
      family: [{ sessionId: w(1), status: 'stopped', pinned: false }],
      inFlight: 1,
      woken: 1,
    });
    await expect(claimAgentWorker(sql, ARGS)).resolves.toEqual({
      parked: 'org_limit',
    });
    expect(statements.some((s) => s.text.includes(CLAIM))).toBe(false);
    // The room counts the woken runs that have not claimed yet.
    const room = statements.find((s) => s.text.includes(ROOM));
    expect(room?.values).toContainEqual(
      expect.stringContaining('session_claimed_at_ms IS NULL'),
    );
    expect(room?.values).toContainEqual(
      expect.stringContaining('waiting_reason IS NOT NULL'),
    );
  });

  it('still takes a worker that is up, which needs no room [SBX-R20]', async () => {
    const { sql } = claimSql({
      family: [{ sessionId: w(1), status: 'active', pinned: false }],
      inFlight: 1,
      woken: 1,
    });
    await expect(claimAgentWorker(sql, ARGS)).resolves.toMatchObject({
      sessionId: w(1),
    });
  });

  it('lets the woken run take the room, whatever other woken runs wait', async () => {
    const { sql } = claimSql({
      run: { woken: true },
      family: [{ sessionId: w(1), status: 'stopped', pinned: false }],
      inFlight: 1,
      woken: 1,
    });
    await expect(claimAgentWorker(sql, ARGS)).resolves.toEqual({
      sessionId: w(1),
      worker: 1,
      moved: false,
    });
  });

  it('tells the start it will wait [TASK-R26]', async () => {
    const { sql } = claimSql({
      run: { status: 'queued', parked: false, reason: null },
      family: [{ sessionId: w(1), status: 'stopped', pinned: false }],
      inFlight: 1,
      woken: 1,
    });
    await expect(
      predictWorkerWait(sql, { organizationId: 'org-1', runId: 'run-1' }),
    ).resolves.toBe('org_limit');
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

  it.each([
    ['its host refused it', { reason: 'host' as const }, true],
    ['every slot is held', { reason: 'org_limit' as const }, false],
    [
      'its runtime refused the exec',
      { reason: 'host' as const, execRefused: true },
      false,
    ],
  ])(
    'remembers the worker it was refused in, once, only when %s [TASK-R85]',
    async (_label, refusal, remembered) => {
      const { sql, statements } = fakeSql([
        [
          PARK,
          [
            {
              organizationId: 'org-1',
              taskId: 'task-1',
              agentId: AGENT,
              execId: 'exec-1',
              sessionId: w(3),
            },
          ],
        ],
      ]);
      await sql.begin((tx) =>
        parkAgentRunInTx(tx, { runId: 'run-1', execId: 'exec-1', ...refusal }),
      );
      const park = statements.find((s) => s.text.includes(PARK));
      const remember = 'host_refused_session_ids = CASE WHEN NOT ?';
      expect(park?.text).toContain(
        `${remember} OR session_id = ANY (host_refused_session_ids) THEN host_refused_session_ids ELSE array_append(host_refused_session_ids, session_id) END`,
      );
      expect(valueAt(park, remember)).toBe(remembered);
    },
  );
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
