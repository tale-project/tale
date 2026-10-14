// @vitest-environment node

import type { Sql, TransactionSql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SpawnerStatusError,
  type SandboxHeavyLease,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  cancelAgentRunInTx,
  failAgentRun,
  failAgentRunFromTurn,
  settleAgentRun,
} from '../tasks/agent-runs.ts';
import { requestRunLeaseReleaseInTx } from './heavy-lease-requests.ts';
import {
  acquireRunHeavyLease,
  readActiveHeavyLeases,
  releaseEndedRunLeases,
  releaseRunHeavyLease,
  sweepHeavyLeases,
  type LeaseSpawner,
} from './heavy-leases.ts';

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn().mockResolvedValue(null),
}));
vi.mock('../tasks/run-ledger.ts', () => ({
  recordTaskAgentRunLedgerEntry: vi.fn(),
}));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../tasks/run-failure-notice.ts', () => ({
  announceAgentRunFailed: vi.fn(),
  withdrawAgentRunFailedNotices: vi.fn(),
}));
vi.mock('./gateway-keys.ts', () => ({
  revokeSessionGatewayKeys: vi.fn(async () => {}),
}));
vi.mock('../tasks/model-capacity-holds.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../tasks/model-capacity-holds.ts')
  >()),
  recordModelCapacityRefusalInTx: vi.fn(),
  clearModelCapacityHoldInTx: vi.fn(),
}));

type Row = Record<string, unknown>;
interface Call {
  text: string;
  values: unknown[];
}

/** A postgres.js stand-in answering each statement from its
 * whitespace-collapsed text; `begin` hands the callback the same tag. */
function fakeSql(answer: (text: string, values: unknown[]) => Row[]): {
  sql: Sql;
  calls: Call[];
} {
  const calls: Call[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<Row[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    calls.push({ text, values });
    const rows = answer(text, values);
    return Promise.resolve(Object.assign([...rows], { count: rows.length }));
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    begin: (callback: (tx: TransactionSql) => unknown): unknown =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the same stand-in serves as the transaction
      callback(tag as unknown as TransactionSql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a three-member stand-in for the postgres.js root instance
  return { sql: sql as unknown as Sql, calls };
}

const PROVE = 'SELECT r.id AS "runId", r.session_id AS "sessionId"';
const SESSION_OWNER = 'SELECT owner_type AS "ownerType"';
const HELD = 'SELECT lease_id AS "leaseId", label';
const LIVE_LOCK = 'FOR SHARE';
const INSERT = 'INSERT INTO app.sandbox_heavy_leases';
const ROW = 'SELECT session_id AS "sessionId", expires_at_ms';
const RUN_LIVE =
  "SELECT id FROM app.project_agent_runs WHERE id = ? AND org_id = ? AND status IN ('queued', 'running')";
const RUN_ROWS = 'released_at_ms IS NOT NULL AS released FROM';
const END =
  'UPDATE app.sandbox_heavy_leases SET released_at_ms = ?, release_reason = ? WHERE org_id = ? AND lease_id = ?';

const TOKEN = {
  organizationId: 'org-1',
  sessionId: 'pa-ada-1',
  taskRunExecId: 'exec-1',
};
const RUN = { runId: 'run-1', sessionId: 'pa-ada-1' };

const LEASE: SandboxHeavyLease = {
  id: 'lease-1',
  sessionId: 'pa-ada-1',
  organizationId: 'org-1',
  class: 'heavy',
  label: 'npm ci',
  predictedGrowthBytes: 3 * 1024 ** 3,
  memoryBytes: 1024 ** 3,
  acquiredAtMs: 1_000,
  expiresAtMs: 1_801_000,
};

function standIn(overrides: Partial<LeaseSpawner> = {}): LeaseSpawner {
  return {
    acquire: vi.fn(async () => ({ granted: true as const, lease: LEASE })),
    release: vi.fn(async () => 'released' as const),
    list: vi.fn(async () => [LEASE]),
    ...overrides,
  };
}

/** A live run of Ada's agent on its own session, holding no lease yet. */
function liveRun(more: (text: string) => Row[] | undefined = () => undefined) {
  return fakeSql((text) => {
    const answered = more(text);
    if (answered !== undefined) return answered;
    if (text.startsWith(PROVE)) return [RUN];
    if (text.includes(LIVE_LOCK)) return [{ id: 'run-1' }];
    return [];
  });
}

beforeEach(() => {
  vi.mocked(addJobInTx).mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('acquireRunHeavyLease', () => {
  it('asks the host on the run’s own session and records the lease for the run [SBX-R28]', async () => {
    const { sql, calls } = liveRun();
    const spawner = standIn();

    const answer = await acquireRunHeavyLease(
      sql,
      {
        ...TOKEN,
        label: 'npm ci',
        predictedGrowthBytes: 3 * 1024 ** 3,
        ttlMs: 600_000,
      },
      spawner,
    );

    expect(answer).toEqual({
      outcome: 'granted',
      lease: { leaseId: 'lease-1', label: 'npm ci', expiresAtMs: 1_801_000 },
    });
    expect(spawner.acquire).toHaveBeenCalledWith('pa-ada-1', {
      organizationId: 'org-1',
      label: 'npm ci',
      predictedGrowthBytes: 3 * 1024 ** 3,
      ttlMs: 600_000,
    });
    // The run is the live one on the token's session and execution, of the
    // agent the session belongs to.
    const prove = calls.find((call) => call.text.startsWith(PROVE));
    expect(prove?.values).toEqual(['org-1', 'pa-ada-1', 'exec-1']);
    expect(prove?.text).toContain("s.owner_type = 'project_agent'");
    const insert = calls.find((call) => call.text.startsWith(INSERT));
    expect(insert?.values.slice(0, 5)).toEqual([
      'lease-1',
      'org-1',
      'pa-ada-1',
      'run-1',
      'exec-1',
    ]);
  });

  it('answers the lease a run holds instead of taking a second one [SBX-R28]', async () => {
    const { sql } = liveRun((text) =>
      text.startsWith(HELD)
        ? [{ leaseId: 'lease-0', label: 'docker build', expiresAtMs: 9_000 }]
        : undefined,
    );
    const spawner = standIn();

    await expect(
      acquireRunHeavyLease(sql, { ...TOKEN, label: 'npm ci' }, spawner),
    ).resolves.toEqual({
      outcome: 'already_held',
      lease: { leaseId: 'lease-0', label: 'docker build', expiresAtMs: 9_000 },
    });
    expect(spawner.acquire).not.toHaveBeenCalled();
  });

  it('passes the host’s refusal on with its reason and wait [SBX-R29]', async () => {
    const { sql, calls } = liveRun();
    const spawner = standIn({
      acquire: vi.fn(async () => ({
        granted: false as const,
        reason: 'limit',
        retryAfterMs: 30_000,
        evidence: null,
      })),
    });

    await expect(
      acquireRunHeavyLease(sql, { ...TOKEN, label: 'docker build' }, spawner),
    ).resolves.toEqual({
      outcome: 'refused',
      reason: 'limit',
      retryAfterMs: 30_000,
    });
    expect(calls.some((call) => call.text.startsWith(INSERT))).toBe(false);
  });

  it('asks again when the host does not answer, after the wait it named [SBX-R29]', async () => {
    const { sql } = liveRun();
    const spawner = standIn({
      acquire: vi.fn(async () => {
        throw new SpawnerStatusError(
          'sandbox lease request failed (503)',
          new Response(null, { status: 503, headers: { 'retry-after': '5' } }),
        );
      }),
    });

    await expect(
      acquireRunHeavyLease(sql, { ...TOKEN, label: 'npm ci' }, spawner),
    ).resolves.toEqual({ outcome: 'unreachable', retryAfterMs: 5_000 });
  });

  it.each([
    {
      case: 'a host that cannot be judged',
      acquire: async () => ({
        granted: false as const,
        reason: 'unavailable',
        retryAfterMs: 60_000,
        evidence: null,
      }),
    },
    {
      case: 'an answer this platform cannot read',
      acquire: async () => {
        throw new SpawnerStatusError(
          'sandbox lease request failed (409)',
          new Response(null, { status: 409 }),
        );
      },
    },
  ])(
    'reads $case as no leases at all, so the run never waits [SBX-R30]',
    async ({ acquire }) => {
      const { sql } = liveRun();

      await expect(
        acquireRunHeavyLease(
          sql,
          { ...TOKEN, label: 'npm ci' },
          standIn({ acquire: vi.fn(acquire) }),
        ),
      ).resolves.toEqual({ outcome: 'unavailable' });
    },
  );

  it('acts only for a project agent’s live task run [SBX-R31]', async () => {
    const spawner = standIn();
    const noExec = fakeSql(() => []);
    await expect(
      acquireRunHeavyLease(
        noExec.sql,
        { organizationId: 'org-1', sessionId: 'pa-ada-1', label: 'npm ci' },
        spawner,
      ),
    ).resolves.toEqual({ outcome: 'not_a_project_agent_run' });
    expect(noExec.calls).toHaveLength(0);

    const automation = fakeSql((text) =>
      text.startsWith(SESSION_OWNER) ? [{ ownerType: 'workflow_run' }] : [],
    );
    await expect(
      acquireRunHeavyLease(automation.sql, { ...TOKEN, label: 'x' }, spawner),
    ).resolves.toEqual({ outcome: 'not_a_project_agent_run' });

    const ended = fakeSql((text) =>
      text.startsWith(SESSION_OWNER) ? [{ ownerType: 'project_agent' }] : [],
    );
    await expect(
      acquireRunHeavyLease(ended.sql, { ...TOKEN, label: 'x' }, spawner),
    ).resolves.toEqual({ outcome: 'run_ended' });
    expect(spawner.acquire).not.toHaveBeenCalled();
  });

  it('ends at once a lease granted to a run that ended meanwhile [SBX-R32]', async () => {
    const { sql, calls } = liveRun((text) =>
      text.includes(LIVE_LOCK) ? [] : undefined,
    );
    const spawner = standIn();

    await expect(
      acquireRunHeavyLease(sql, { ...TOKEN, label: 'npm ci' }, spawner),
    ).resolves.toEqual({ outcome: 'run_ended' });
    expect(spawner.release).toHaveBeenCalledWith({
      organizationId: 'org-1',
      sessionId: 'pa-ada-1',
      leaseId: 'lease-1',
    });
    expect(calls.some((call) => call.text.startsWith(INSERT))).toBe(false);
  });
});

describe('releaseRunHeavyLease', () => {
  it('releases the run’s own lease on its own session [SBX-R31]', async () => {
    const { sql, calls } = liveRun((text) =>
      text.startsWith(ROW)
        ? [{ sessionId: 'pa-ada-1', expiresAtMs: 9_000, released: false }]
        : undefined,
    );
    const spawner = standIn();

    await expect(
      releaseRunHeavyLease(sql, { ...TOKEN, leaseId: 'lease-1' }, spawner),
    ).resolves.toEqual({
      outcome: 'released',
      leaseId: 'lease-1',
      alreadyReleased: false,
    });
    const lookup = calls.find((call) => call.text.startsWith(ROW));
    expect(lookup?.values).toEqual(['lease-1', 'org-1', 'run-1', 'pa-ada-1']);
    const end = calls.find((call) => call.text.startsWith(END));
    expect(end?.values).toEqual([
      expect.any(Number),
      'released',
      'org-1',
      'lease-1',
    ]);
  });

  it('answers another run’s lease as not found, and that lease stays held [SBX-R31]', async () => {
    const { sql, calls } = liveRun();
    const spawner = standIn();

    await expect(
      releaseRunHeavyLease(sql, { ...TOKEN, leaseId: 'noah-lease' }, spawner),
    ).resolves.toEqual({ outcome: 'not_found' });
    expect(spawner.release).not.toHaveBeenCalled();
    expect(calls.some((call) => call.text.startsWith(END))).toBe(false);
  });

  it('answers a lease that ended already as released, asking nobody [SBX-R32]', async () => {
    const { sql } = liveRun((text) =>
      text.startsWith(ROW)
        ? [{ sessionId: 'pa-ada-1', expiresAtMs: 9_000, released: true }]
        : undefined,
    );
    const spawner = standIn();

    await expect(
      releaseRunHeavyLease(sql, { ...TOKEN, leaseId: 'lease-1' }, spawner),
    ).resolves.toEqual({
      outcome: 'released',
      leaseId: 'lease-1',
      alreadyReleased: true,
    });
    expect(spawner.release).not.toHaveBeenCalled();
  });

  it('defers when the host cannot be asked: the lease ends by itself', async () => {
    const { sql, calls } = liveRun((text) =>
      text.startsWith(ROW)
        ? [{ sessionId: 'pa-ada-1', expiresAtMs: 9_000, released: false }]
        : undefined,
    );
    const spawner = standIn({
      release: vi.fn(async () => {
        throw new Error('connection refused');
      }),
    });

    await expect(
      releaseRunHeavyLease(sql, { ...TOKEN, leaseId: 'lease-1' }, spawner),
    ).resolves.toEqual({
      outcome: 'deferred',
      leaseId: 'lease-1',
      expiresAtMs: 9_000,
    });
    expect(calls.some((call) => call.text.startsWith(END))).toBe(false);
  });
});

describe('releaseEndedRunLeases — every lease ends with its run', () => {
  it('ends what the run holds, a lease the host no longer holds included [SBX-R32]', async () => {
    const { sql, calls } = fakeSql((text) =>
      text.includes(RUN_ROWS)
        ? [
            { leaseId: 'lease-1', sessionId: 'pa-ada-1', released: false },
            { leaseId: 'lease-2', sessionId: 'pa-ada-1', released: false },
            { leaseId: 'lease-3', sessionId: 'pa-ada-1', released: true },
          ]
        : [],
    );
    const release = vi
      .fn<LeaseSpawner['release']>()
      .mockResolvedValueOnce('released')
      .mockResolvedValueOnce('gone');

    await expect(
      releaseEndedRunLeases(
        sql,
        { organizationId: 'org-1', runId: 'run-1' },
        standIn({ release }),
      ),
    ).resolves.toEqual({ ended: 2 });
    expect(release.mock.calls.map(([args]) => args.leaseId)).toEqual([
      'lease-1',
      'lease-2',
    ]);
    const ends = calls.filter((call) => call.text.startsWith(END));
    expect(ends.map((call) => [call.values[1], call.values[3]])).toEqual([
      ['run_ended', 'lease-1'],
      ['run_ended', 'lease-2'],
    ]);
  });

  it('is idempotent: once every lease has ended, nothing is asked again [SBX-R32]', async () => {
    const { sql } = fakeSql((text) =>
      text.includes(RUN_ROWS)
        ? [{ leaseId: 'lease-1', sessionId: 'pa-ada-1', released: true }]
        : [],
    );
    const spawner = standIn();

    await expect(
      releaseEndedRunLeases(
        sql,
        { organizationId: 'org-1', runId: 'run-1' },
        spawner,
      ),
    ).resolves.toEqual({ ended: 0 });
    expect(spawner.release).not.toHaveBeenCalled();
  });

  it('ends on the host a lease whose row went with its run [SBX-R32]', async () => {
    const { sql } = fakeSql(() => []);
    const spawner = standIn();

    await expect(
      releaseEndedRunLeases(
        sql,
        {
          organizationId: 'org-1',
          runId: 'run-1',
          leases: [{ leaseId: 'lease-9', sessionId: 'pa-ada-2' }],
        },
        spawner,
      ),
    ).resolves.toEqual({ ended: 1 });
    expect(spawner.release).toHaveBeenCalledWith({
      organizationId: 'org-1',
      sessionId: 'pa-ada-2',
      leaseId: 'lease-9',
    });
  });

  it('throws when the host could not end one, keeping the ones it did end [SBX-R32]', async () => {
    const { sql, calls } = fakeSql((text) =>
      text.includes(RUN_ROWS)
        ? [
            { leaseId: 'lease-1', sessionId: 'pa-ada-1', released: false },
            { leaseId: 'lease-2', sessionId: 'pa-ada-1', released: false },
          ]
        : [],
    );
    const release = vi
      .fn<LeaseSpawner['release']>()
      .mockResolvedValueOnce('released')
      .mockRejectedValueOnce(new Error('spawner restarting'));

    await expect(
      releaseEndedRunLeases(
        sql,
        { organizationId: 'org-1', runId: 'run-1' },
        standIn({ release }),
      ),
    ).rejects.toThrow('could not release 1 of 2');
    const ends = calls.filter((call) => call.text.startsWith(END));
    expect(ends.map((call) => call.values[3])).toEqual(['lease-1']);
  });

  it('leaves the leases of a run that is live alone', async () => {
    const { sql } = fakeSql((text) =>
      text.startsWith(RUN_LIVE) ? [{ id: 'run-1' }] : [],
    );
    const spawner = standIn();

    await expect(
      releaseEndedRunLeases(
        sql,
        { organizationId: 'org-1', runId: 'run-1' },
        spawner,
      ),
    ).resolves.toEqual({ ended: 0 });
    expect(spawner.release).not.toHaveBeenCalled();
  });
});

describe('the end of a run asks for its leases’ release in its own transaction', () => {
  const HELD_LEASES = [{ leaseId: 'lease-1', sessionId: 'pa-ada-1' }];
  const holding =
    (elector: Row) =>
    (text: string): Row[] => {
      if (text.startsWith('UPDATE app.project_agent_runs')) return [elector];
      if (
        text.startsWith('SELECT lease_id AS "leaseId", session_id') &&
        text.includes('released_at_ms IS NULL')
      ) {
        return HELD_LEASES;
      }
      return [];
    };
  const asked = () =>
    vi
      .mocked(addJobInTx)
      .mock.calls.filter(([, name]) => name === 'sandbox.release_run_leases');

  it('queues the release with the leases the transaction read [SBX-R32]', async () => {
    const { sql } = fakeSql(holding({}));
    await sql.begin((tx) =>
      requestRunLeaseReleaseInTx(tx, {
        organizationId: 'org-1',
        runId: 'run-1',
      }),
    );
    expect(addJobInTx).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      'sandbox.release_run_leases',
      { organizationId: 'org-1', runId: 'run-1', leases: HELD_LEASES },
      { singletonKey: 'run-leases:run-1' },
    );
  });

  it('queues nothing for a run that took no lease', async () => {
    const { sql } = fakeSql(() => []);
    await sql.begin((tx) =>
      requestRunLeaseReleaseInTx(tx, {
        organizationId: 'org-1',
        runId: 'run-1',
      }),
    );
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it.each([
    {
      end: 'a settle',
      run: (sql: Sql) =>
        settleAgentRun(sql, { runId: 'run-1', resultText: 'done' }),
    },
    {
      end: 'a failure the turn reported',
      run: (sql: Sql) =>
        failAgentRunFromTurn(sql, {
          runId: 'run-1',
          error: 'the agent stopped responding',
          failureCode: 'agent_unresponsive',
        }),
    },
    {
      end: 'a failure the deadline sweep decided',
      run: (sql: Sql) =>
        failAgentRun(sql, {
          organizationId: 'org-1',
          runId: 'run-1',
          execId: 'exec-1',
          error: 'the run reached its time limit',
        }),
    },
    {
      end: 'a cancel',
      run: (sql: Sql) =>
        sql.begin((tx) =>
          cancelAgentRunInTx(tx, {
            organizationId: 'org-1',
            runId: 'run-1',
            taskId: 'task-1',
          }),
        ),
    },
  ])('$end releases every lease the run holds [SBX-R32]', async ({ run }) => {
    const { sql } = fakeSql(
      holding({
        id: 'run-1',
        organizationId: 'org-1',
        taskId: 'task-1',
        agentId: 'agent-1',
        sessionId: 'pa-ada-1',
        execId: 'exec-1',
        harness: 'codex',
        engine: 'harness',
        model: 'sol',
        modelProvider: 'openai',
        threadId: null,
        deadlineAt: 1_000,
        autoRetryAttempt: null,
      }),
    );
    await run(sql);
    expect(asked()).toEqual([
      [
        expect.anything(),
        'sandbox.release_run_leases',
        { organizationId: 'org-1', runId: 'run-1', leases: HELD_LEASES },
        { singletonKey: 'run-leases:run-1' },
      ],
    ]);
  });
});

describe('sweepHeavyLeases — the backstop', () => {
  it('stops counting expired leases, ends those of ended runs, drops old rows [SBX-R32]', async () => {
    const { sql, calls } = fakeSql((text) => {
      if (
        text.includes("release_reason = 'expired' WHERE released_at_ms IS NULL")
      )
        return [{}, {}];
      if (text.startsWith('SELECT DISTINCT l.org_id'))
        return [{ organizationId: 'org-1', runId: 'run-1' }];
      if (text.includes(RUN_ROWS))
        return [{ leaseId: 'lease-1', sessionId: 'pa-ada-1', released: false }];
      if (text.startsWith('DELETE FROM app.sandbox_heavy_leases')) return [{}];
      return [];
    });
    const spawner = standIn();

    await expect(
      sweepHeavyLeases(sql, { now: 10_000_000, spawner }),
    ).resolves.toEqual({ expired: 2, released: 1, pruned: 1 });
    expect(spawner.release).toHaveBeenCalledWith({
      organizationId: 'org-1',
      sessionId: 'pa-ada-1',
      leaseId: 'lease-1',
    });
    // Only runs that ended past the grace: their release job goes first.
    const ended = calls.find((call) =>
      call.text.startsWith('SELECT DISTINCT l.org_id'),
    );
    expect(ended?.text).toContain(
      "r.status IN ('settled', 'failed', 'cancelled')",
    );
    expect(ended?.values).toEqual([10_000_000 - 5 * 60_000, 25]);
  });

  it('goes on to the next run when one cannot be released now', async () => {
    const { sql } = fakeSql((text) => {
      if (text.startsWith('SELECT DISTINCT l.org_id'))
        return [
          { organizationId: 'org-1', runId: 'run-1' },
          { organizationId: 'org-1', runId: 'run-2' },
        ];
      if (text.includes(RUN_ROWS))
        return [{ leaseId: 'lease-x', sessionId: 'pa-ada-1', released: false }];
      return [];
    });
    const release = vi
      .fn<LeaseSpawner['release']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('released');

    await expect(
      sweepHeavyLeases(sql, { spawner: standIn({ release }) }),
    ).resolves.toMatchObject({ released: 1 });
    expect(release).toHaveBeenCalledTimes(2);
  });
});

describe('readActiveHeavyLeases', () => {
  it('lists the host’s leases with the run that took each [SBX-R33]', async () => {
    const other: SandboxHeavyLease = {
      ...LEASE,
      id: 'lease-0',
      acquiredAtMs: 500,
      label: null,
    };
    const { sql, calls } = fakeSql((text) =>
      text.startsWith('SELECT l.lease_id AS "leaseId", r.id AS "runId"')
        ? [
            {
              leaseId: 'lease-1',
              runId: 'run-1',
              taskId: 'task-1',
              agentId: 'agent-1',
              agentName: 'Builder',
              projectId: 'project-1',
            },
          ]
        : [],
    );

    const readback = await readActiveHeavyLeases(
      sql,
      'org-1',
      standIn({ list: vi.fn(async () => [LEASE, other]) }),
    );

    expect(readback).toMatchObject({
      status: 'available',
      leases: [
        { leaseId: 'lease-0', label: null, run: null },
        {
          leaseId: 'lease-1',
          sessionId: 'pa-ada-1',
          label: 'npm ci',
          expiresAt: 1_801_000,
          run: {
            runId: 'run-1',
            taskId: 'task-1',
            agentName: 'Builder',
            projectId: 'project-1',
          },
        },
      ],
    });
    expect(calls[0]?.values[0]).toBe('org-1');
  });

  it('says why when the host cannot be read', async () => {
    const { sql } = fakeSql(() => []);
    await expect(
      readActiveHeavyLeases(
        sql,
        'org-1',
        standIn({ list: vi.fn(async () => null) }),
      ),
    ).resolves.toEqual({ status: 'unavailable', reason: 'unsupported' });
    await expect(
      readActiveHeavyLeases(
        sql,
        'org-1',
        standIn({
          list: vi.fn(async () => {
            throw new Error('down');
          }),
        }),
      ),
    ).resolves.toEqual({ status: 'unavailable', reason: 'unreachable' });
  });
});
