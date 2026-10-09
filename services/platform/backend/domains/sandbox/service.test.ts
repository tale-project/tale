// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SessionDuplicateError,
  sessionDestroy,
  sessionSetPinned,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { wakeParkedAgentRuns } from '../tasks/agent-runs.ts';
import { revokeSessionGatewayKeys } from './gateway-keys.ts';
import {
  pinSession,
  syncSessionPin,
  reconcileSession,
  recreatePinnedSession,
  teardownSession,
  type ReconcileSpawner,
} from './service.ts';
import type { SessionRow } from './sessions.ts';

const { postgresFactory } = vi.hoisted(() => ({ postgresFactory: vi.fn() }));
vi.mock('postgres', () => ({ default: postgresFactory }));

// The real error classes (the reconcile tells a duplicate create apart by
// class); every spawner verb is a mock.
vi.mock(
  '../../core/node_only/sandbox/helpers/session_client.ts',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../../core/node_only/sandbox/helpers/session_client.ts')
    >()),
    sessionCreate: vi.fn(),
    sessionDestroy: vi.fn(),
    sessionIsAlive: vi.fn(),
    sessionSetPinned: vi.fn(),
  }),
);
vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(async () => 'job-1'),
}));
vi.mock('../tasks/agent-runs.ts', () => ({
  wakeParkedAgentRuns: vi.fn(async () => 0),
}));
vi.mock('./gateway-keys.ts', () => ({
  revokeSessionGatewayKeys: vi.fn(async () => ({ revoked: 0, failed: 0 })),
}));

const OWNED_SESSION: SessionRow = {
  id: 'row-a',
  organizationId: 'org-a',
  sessionId: 'session-a',
  profile: 'agent',
  status: 'active',
  ownerType: 'project_agent',
  ownerId: 'agent-a',
  createdBy: 'user-a',
  agentKind: 'opencode',
  llmGatewayKeyId: null,
  pinned: false,
  createdAt: 1000,
  expiresAt: 2000,
  lastActivityAt: null,
  destroyedAt: null,
};

interface Statement {
  text: string;
  values: unknown[];
}

const LOCK_KEY = 'sandbox-lifecycle:["org-a","session-a"]';

/**
 * Exercise the real scoped lookups and settlement over two scripted
 * transports, told apart so the tests can see WHICH connection each
 * statement used:
 *  - the ROOT pool: its plain queries are the reconcile's unlocked first
 *    look (`root`); its `begin` is the lifecycle lock transaction, which
 *    must carry the advisory lock and nothing else (`locks`);
 *  - the dedicated DATA client `postgres()` returns under the lock — every
 *    row read and write of a lifecycle transition (`data`).
 * Both answer from one stored row; the SELECT's bound organization and id
 * must both match it. `lockFree: false` makes a TRIED lock find it taken.
 * `order` interleaves every statement (`<channel>:<verb>`) with the opening
 * of the data client (`connect`); a test hands it to the spawner fakes too,
 * to see what ran before the lock.
 */
function fakeSql(row: SessionRow | null, options: { lockFree?: boolean } = {}) {
  const root: Statement[] = [];
  const locks: Statement[] = [];
  const data: Statement[] = [];
  const order: string[] = [];
  const stored = row === null ? null : { ...row };
  const answer = (text: string, values: unknown[]): unknown[] => {
    if (text.startsWith('SELECT pg_try_advisory_xact_lock')) {
      return [{ acquired: options.lockFree ?? true }];
    }
    if (text.startsWith('SELECT pg_advisory_xact_lock')) return [];
    if (text.startsWith('SELECT')) {
      const matches =
        stored !== null &&
        values.at(-2) === stored.sessionId &&
        values.at(-1) === stored.organizationId;
      return matches ? [{ ...stored }] : [];
    }
    if (text.startsWith("UPDATE app.sandbox_sessions SET status = 'active'")) {
      // The recreate's creating → active, by row id and org.
      if (
        stored === null ||
        stored.status !== 'creating' ||
        !values.includes(stored.id) ||
        !values.includes(stored.organizationId)
      )
        return [];
      stored.status = 'active';
      return [{ id: stored.id }];
    }
    if (text.startsWith("UPDATE app.sandbox_sessions SET status = 'stopped'")) {
      // The heal of an agent session that keeps its workspace: by row id
      // and org, only from a compute-holding status, only while unpinned.
      if (
        stored === null ||
        !['creating', 'active', 'degraded'].includes(stored.status) ||
        stored.pinned ||
        !values.includes(stored.id) ||
        !values.includes(stored.organizationId)
      )
        return [];
      stored.status = 'stopped';
      return [{ id: stored.id }];
    }
    if (text.startsWith('UPDATE app.sandbox_sessions')) {
      if (
        stored === null ||
        stored.status === 'destroyed' ||
        !values.includes(stored.sessionId) ||
        !values.includes(stored.organizationId)
      )
        return [];
      if (text.includes('pinned =')) stored.pinned = Boolean(values[0]);
      else stored.status = 'destroyed';
      return [{ id: stored.id }];
    }
    return [];
  };
  const verb = (text: string): string => {
    if (text.startsWith('SELECT pg_try_advisory_xact_lock')) return 'try-lock';
    if (text.startsWith('SELECT pg_advisory_xact_lock')) return 'lock';
    return text.split(' ')[0] ?? text;
  };
  const recorder =
    (log: Statement[], channel: string) =>
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
      log.push({ text, values });
      order.push(`${channel}:${verb(text)}`);
      return Promise.resolve(answer(text, values));
    };
  const unsafe = (fragment: string) => fragment;
  // A postgres.js transaction really has savepoint and NO begin. Keeping
  // that distinction catches accidental nested root-pool transactions.
  const transaction = (log: Statement[], channel: string) => {
    const query = recorder(log, channel);
    const tx = Object.assign(query, {
      unsafe,
      savepoint: <T>(callback: (transaction: typeof query) => Promise<T>) =>
        callback(tx),
    });
    return tx;
  };
  const pool = (
    log: Statement[],
    channel: string,
    tx: ReturnType<typeof transaction>,
  ) => {
    const query = recorder(log, channel);
    return Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) =>
        query(strings, ...values),
      {
        unsafe,
        options: { host: ['itest-host'], ssl: 'require', max: 3 },
        end: vi.fn(async () => {}),
        begin: <T>(callback: (transaction: typeof tx) => Promise<T>) =>
          callback(tx),
      },
    );
  };
  const rootSql = pool(root, 'root', transaction(locks, 'lock'));
  const dataSql = pool(data, 'data', transaction(data, 'data'));
  postgresFactory.mockImplementation(() => {
    order.push('connect');
    return dataSql;
  });
  return {
    sql: rootSql as unknown as Sql,
    dataSql: dataSql as unknown as Sql,
    root,
    locks,
    data,
    order,
    stored,
    end: dataSql.end,
  };
}

/** The lock transaction carried exactly the session's advisory lock —
 * waited for or tried — and the data work ran on one dedicated `max: 1`
 * connection with the root pool's resolved options, closed once. */
function expectLockedOnce(
  locks: Statement[],
  end: ReturnType<typeof vi.fn>,
  kind: 'wait' | 'try',
): void {
  expect(locks).toHaveLength(1);
  expect(locks[0]?.text).toContain(
    kind === 'wait' ? 'pg_advisory_xact_lock' : 'pg_try_advisory_xact_lock',
  );
  expect(locks[0]?.values).toEqual([LOCK_KEY]);
  expect(postgresFactory).toHaveBeenCalledExactlyOnceWith({
    host: ['itest-host'],
    ssl: 'require',
    max: 1,
  });
  expect(end).toHaveBeenCalledOnce();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionDestroy).mockResolvedValue(true);
  vi.mocked(sessionSetPinned).mockResolvedValue(true);
});

describe('teardownSession ownership and confirmed deletion', () => {
  it.each([
    ['another organization', { ...OWNED_SESSION, organizationId: 'org-b' }],
    ['no organization', null],
  ])('does not touch a session belonging to %s', async (_label, row) => {
    const { sql, root, locks, data, stored, end } = fakeSql(row);

    expect(
      await teardownSession(sql, {
        organizationId: 'org-a',
        sessionId: 'session-a',
      }),
    ).toBe(false);

    expectLockedOnce(locks, end, 'wait');
    expect(root).toEqual([]);
    expect(data).toHaveLength(1);
    expect(data[0]?.text).toContain('WHERE session_id = ? AND org_id = ?');
    expect(data[0]?.values.slice(-2)).toEqual(['session-a', 'org-a']);
    expect(sessionSetPinned).not.toHaveBeenCalled();
    expect(sessionDestroy).not.toHaveBeenCalled();
    expect(revokeSessionGatewayKeys).not.toHaveBeenCalled();
    expect(wakeParkedAgentRuns).not.toHaveBeenCalled();
    expect(stored?.status).toBe(row?.status);
  });

  it.each([true, false])(
    'settles an owned session after confirmed deletion or absence (%s), on the dedicated connection [SBX-R11]',
    async (destroyed) => {
      const { sql, dataSql, root, locks, data, stored, end } =
        fakeSql(OWNED_SESSION);
      let stateAtDestroy: unknown;
      vi.mocked(sessionDestroy).mockImplementationOnce(async () => {
        stateAtDestroy = {
          statements: data.length,
          status: stored?.status,
          spawnerUnpinned: vi.mocked(sessionSetPinned).mock.calls,
          revocations: vi.mocked(revokeSessionGatewayKeys).mock.calls.length,
        };
        return destroyed;
      });
      const args = { organizationId: 'org-a', sessionId: 'session-a' };

      await expect(teardownSession(sql, args)).resolves.toBe(true);

      expect(sessionDestroy).toHaveBeenCalledExactlyOnceWith('session-a');
      // An unpinned row is not rewritten before the destroy (its lifetime
      // stays as it was), but the spawner's pin is dropped either way.
      expect(stateAtDestroy).toEqual({
        statements: 1,
        status: 'active',
        spawnerUnpinned: [['session-a', false]],
        revocations: 0,
      });
      expect(stored?.status).toBe('destroyed');
      expectLockedOnce(locks, end, 'wait');
      expect(root).toEqual([]);
      expect(revokeSessionGatewayKeys).toHaveBeenCalledExactlyOnceWith(
        dataSql,
        args,
      );
      expect(wakeParkedAgentRuns).toHaveBeenCalledExactlyOnceWith(
        dataSql,
        'org-a',
      );
    },
  );

  it('leaves a pinned session retryable and unpinned on both sides when the spawner cannot confirm deletion [SBX-R11]', async () => {
    const { sql, locks, data, stored, end } = fakeSql({
      ...OWNED_SESSION,
      pinned: true,
    });
    const failure = new Error('sandbox session destroy failed (503)');
    let pinnedAtDestroy: unknown;
    vi.mocked(sessionDestroy).mockImplementationOnce(async () => {
      pinnedAtDestroy = {
        row: stored?.pinned,
        spawner: vi.mocked(sessionSetPinned).mock.calls,
      };
      throw failure;
    });

    await expect(
      teardownSession(sql, {
        organizationId: 'org-a',
        sessionId: 'session-a',
      }),
    ).rejects.toBe(failure);

    // Both unpins land BEFORE the irreversible remote delete: a container
    // that survives it is left to the spawner's idle reaper.
    expect(pinnedAtDestroy).toEqual({
      row: false,
      spawner: [['session-a', false]],
    });
    expect(data.map((statement) => statement.text.split(' SET ')[0])).toEqual([
      expect.stringMatching(/^SELECT/),
      'UPDATE app.sandbox_sessions',
    ]);
    expect(stored?.status).toBe('active');
    expect(stored?.pinned).toBe(false);
    expectLockedOnce(locks, end, 'wait');
    expect(revokeSessionGatewayKeys).not.toHaveBeenCalled();
    expect(wakeParkedAgentRuns).not.toHaveBeenCalled();
  });

  it('does not extend an unpinned session’s lifetime when its Destroy fails', async () => {
    const { sql, data, stored } = fakeSql(OWNED_SESSION);
    const failure = new Error('sandbox session destroy failed (503)');
    vi.mocked(sessionDestroy).mockRejectedValueOnce(failure);

    await expect(
      teardownSession(sql, {
        organizationId: 'org-a',
        sessionId: 'session-a',
      }),
    ).rejects.toBe(failure);

    // No UPDATE at all: `setSessionPinned` would have restarted the TTL.
    expect(
      data.filter((statement) => !statement.text.startsWith('SELECT')),
    ).toEqual([]);
    expect(stored).toMatchObject({ status: 'active', expiresAt: 2000 });
  });

  it('still destroys when the spawner unpin fails', async () => {
    const { sql, stored } = fakeSql({ ...OWNED_SESSION, pinned: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(sessionSetPinned).mockRejectedValueOnce(
      new Error('spawner unreachable'),
    );

    await expect(
      teardownSession(sql, {
        organizationId: 'org-a',
        sessionId: 'session-a',
      }),
    ).resolves.toBe(true);

    expect(sessionDestroy).toHaveBeenCalledExactlyOnceWith('session-a');
    expect(stored).toMatchObject({ status: 'destroyed', pinned: false });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

// A queued Destroy names the row it was asked for. Its retry can run long
// after the request, when that row was settled another way and a turn opened
// a fresh incarnation under the same deterministic id.
describe('teardownSession of a queued Destroy', () => {
  const ARGS = { organizationId: 'org-a', sessionId: 'session-a' };

  it('destroys the row it was asked for, under the session lock', async () => {
    const { sql, locks, stored, end } = fakeSql(OWNED_SESSION);

    await expect(
      teardownSession(sql, { ...ARGS, rowId: OWNED_SESSION.id }),
    ).resolves.toBe(true);

    expect(sessionDestroy).toHaveBeenCalledExactlyOnceWith('session-a');
    expect(stored?.status).toBe('destroyed');
    // The lock key is the session's, whichever row the Destroy names.
    expectLockedOnce(locks, end, 'wait');
  });

  it('leaves a newer incarnation under the reused id alone', async () => {
    const { sql, data, stored } = fakeSql({
      ...OWNED_SESSION,
      id: 'row-fresh',
      createdAt: 5000,
    });

    await expect(
      teardownSession(sql, { ...ARGS, rowId: OWNED_SESSION.id }),
    ).resolves.toBe(false);

    expect(sessionSetPinned).not.toHaveBeenCalled();
    expect(sessionDestroy).not.toHaveBeenCalled();
    expect(revokeSessionGatewayKeys).not.toHaveBeenCalled();
    expect(
      data.filter((statement) => !statement.text.startsWith('SELECT')),
    ).toEqual([]);
    expect(stored?.status).toBe('active');
  });

  it('does nothing once the row it was asked for is settled', async () => {
    const { sql, stored } = fakeSql({
      ...OWNED_SESSION,
      status: 'destroyed',
      destroyedAt: 3000,
    });

    await expect(
      teardownSession(sql, { ...ARGS, rowId: OWNED_SESSION.id }),
    ).resolves.toBe(false);

    expect(sessionSetPinned).not.toHaveBeenCalled();
    expect(sessionDestroy).not.toHaveBeenCalled();
    expect(stored?.status).toBe('destroyed');
  });
});

describe('pinSession serializes with the other lifecycle transitions', () => {
  it.each([true, false])(
    'writes the row (pinned=%s) on the dedicated connection under the lock, then patches the spawner',
    async (pinned) => {
      const { sql, root, locks, data, stored, end } = fakeSql({
        ...OWNED_SESSION,
        pinned: !pinned,
      });
      let rowAtPatch: unknown;
      vi.mocked(sessionSetPinned).mockImplementationOnce(async () => {
        rowAtPatch = stored?.pinned;
        return true;
      });

      await expect(
        pinSession(sql, {
          organizationId: 'org-a',
          sessionId: 'session-a',
          pinned,
        }),
      ).resolves.toBe(true);

      expect(rowAtPatch).toBe(pinned);
      expect(sessionSetPinned).toHaveBeenCalledExactlyOnceWith(
        'session-a',
        pinned,
      );
      expect(data).toHaveLength(2);
      expect(data[0]?.text).toMatch(
        /^UPDATE app\.sandbox_sessions SET pinned =/,
      );
      expect(addJobInTx).toHaveBeenCalledWith(
        expect.anything(),
        'sandbox.sync_pin',
        { organizationId: 'org-a', sessionId: 'session-a', rowId: 'row-a' },
        { singletonKey: JSON.stringify(['org-a', 'session-a', 'row-a']) },
      );
      expect(root).toEqual([]);
      expectLockedOnce(locks, end, 'wait');
    },
  );

  it('answers not found for another organization’s session without asking the spawner [SBX-R3]', async () => {
    const { sql, stored } = fakeSql({
      ...OWNED_SESSION,
      organizationId: 'org-b',
    });

    await expect(
      pinSession(sql, {
        organizationId: 'org-a',
        sessionId: 'session-a',
        pinned: true,
      }),
    ).resolves.toBe(false);

    expect(sessionSetPinned).not.toHaveBeenCalled();
    expect(stored?.pinned).toBe(false);
  });

  it('keeps the row pinned when the spawner patch fails', async () => {
    const { sql, stored } = fakeSql(OWNED_SESSION);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(sessionSetPinned).mockRejectedValueOnce(
      new Error('spawner unreachable'),
    );

    await expect(
      pinSession(sql, {
        organizationId: 'org-a',
        sessionId: 'session-a',
        pinned: true,
      }),
    ).rejects.toThrow('spawner unreachable');

    expect(stored?.pinned).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('does not acknowledge an unpin the runtime refused, and preserves its intent', async () => {
    const { sql, stored } = fakeSql({ ...OWNED_SESSION, pinned: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(sessionSetPinned).mockResolvedValueOnce(false);
    await expect(
      pinSession(sql, {
        organizationId: 'org-a',
        sessionId: 'session-a',
        pinned: false,
      }),
    ).rejects.toThrow('did not confirm pin=false');
    expect(stored?.pinned).toBe(false);
    warn.mockRestore();
  });
});

/** The reconcile's spawner, scripted: its liveness answer is fixed, and every
 * verb it is asked for lands on one ordered log — its own, or one it shares
 * with the database fake (`order`). */
function fakeSpawner(
  alive: boolean,
  overrides: Partial<ReconcileSpawner> = {},
  calls: string[] = [],
): { spawner: ReconcileSpawner; calls: string[] } {
  const spawner: ReconcileSpawner = {
    isAlive: vi.fn((sessionId: string) => {
      calls.push(`isAlive ${sessionId}`);
      return Promise.resolve(alive);
    }),
    setPinned: vi.fn((sessionId: string, pinned: boolean) => {
      calls.push(`setPinned ${sessionId} ${pinned}`);
      return Promise.resolve(true);
    }),
    create: vi.fn((body: { sessionId: string }) => {
      calls.push(`create ${body.sessionId}`);
      return Promise.resolve({ session: { sessionId: body.sessionId } });
    }),
    ...overrides,
  };
  return { spawner, calls };
}

const PINNED_SESSION: SessionRow = {
  ...OWNED_SESSION,
  pinned: true,
  expiresAt: 10 * 365 * 24 * 60 * 60 * 1000,
};

const ARGS = { organizationId: 'org-a', sessionId: 'session-a' };

/** The row reads as it was, and nothing settled it or its credentials. */
function expectRowUntouched(
  statements: Statement[],
  stored: SessionRow | null,
  status = 'active',
): void {
  expect(
    statements.filter((statement) => !statement.text.startsWith('SELECT')),
  ).toEqual([]);
  expect(stored?.status).toBe(status);
  expect(revokeSessionGatewayKeys).not.toHaveBeenCalled();
  expect(wakeParkedAgentRuns).not.toHaveBeenCalled();
}

describe('reconcileSession keeps a pinned session pinned', () => {
  it.each([false, true])(
    'retries an unsynchronized pin even when its acknowledged value already equals %s',
    async (pinned) => {
      const { sql, locks, end } = fakeSql({ ...OWNED_SESSION, pinned });
      const { spawner } = fakeSpawner(true, {
        observe: vi.fn(async () => ({ pinned, pinSynchronized: false })),
      });
      await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe(
        pinned ? 'repinned' : 'unpinned',
      );
      expect(vi.mocked(spawner.setPinned).mock.calls[0]?.slice(0, 2)).toEqual([
        'session-a',
        pinned,
      ]);
      expectLockedOnce(locks, end, 'try');
    },
  );

  it('repairs a failed unpin under the lifecycle lock without refreshing it on later sweeps', async () => {
    const { sql, locks, stored } = fakeSql(OWNED_SESSION);
    let runtimePin = true;
    const { spawner } = fakeSpawner(true, {
      observe: vi.fn(async () => ({ pinned: runtimePin })),
      setPinned: vi.fn(async (_id, pinned) => {
        runtimePin = pinned;
        return true;
      }),
    });
    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe(
      'unpinned',
    );
    expect(runtimePin).toBe(false);
    expect(stored?.pinned).toBe(false);
    expect(locks).toHaveLength(1);
    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe('live');
    expect(spawner.setPinned).toHaveBeenCalledTimes(1);
    expect(locks).toHaveLength(1);
  });

  it('leaves a matching runtime pin untouched and retries a refused drift correction', async () => {
    const { sql, locks } = fakeSql(PINNED_SESSION);
    const { spawner } = fakeSpawner(true, {
      observe: vi.fn(async () => ({ pinned: true })),
    });
    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe('live');
    expect(locks).toHaveLength(0);
    expect(spawner.setPinned).not.toHaveBeenCalled();
    const unpinned = fakeSql(OWNED_SESSION);
    spawner.setPinned = vi.fn(async () => false);
    await expect(reconcileSession(unpinned.sql, ARGS, spawner)).rejects.toThrow(
      'did not remove the pin',
    );
    expect(unpinned.stored?.status).toBe('active');
  });
  it('re-asserts the pin on a live pinned session under the tried lock and settles nothing', async () => {
    const { sql, root, locks, data, stored, end } = fakeSql(PINNED_SESSION);
    const { spawner, calls } = fakeSpawner(true);

    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe(
      'repinned',
    );

    expect(calls).toEqual(['isAlive session-a', 'setPinned session-a true']);
    expect(spawner.create).not.toHaveBeenCalled();
    // The unlocked first look on the root pool, the decision on the
    // dedicated connection under the lock.
    expect(root).toHaveLength(1);
    expect(data).toHaveLength(1);
    expectLockedOnce(locks, end, 'try');
    expectRowUntouched(data, stored);
  });

  it('queues the recreate of a gone pinned session instead of creating it or settling the row [SBX-R10]', async () => {
    const { sql, dataSql, locks, data, stored, end } = fakeSql(PINNED_SESSION);
    const { spawner, calls } = fakeSpawner(false);

    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe(
      'recreating',
    );

    // One `exclusive` job per organization + session, queued on the
    // dedicated connection: the batch never waits for a create.
    expect(addJobInTx).toHaveBeenCalledExactlyOnceWith(
      dataSql,
      'sandbox.recreate_pinned',
      ARGS,
      { singletonKey: JSON.stringify(['org-a', 'session-a']) },
    );
    expect(calls).toEqual(['isAlive session-a']);
    expectLockedOnce(locks, end, 'try');
    expectRowUntouched(data, stored);
  });

  it('hands the recreate to an injected scheduler', async () => {
    const { sql, dataSql } = fakeSql(PINNED_SESSION);
    const { spawner } = fakeSpawner(false);
    const schedule = vi.fn(async () => {});

    await expect(
      reconcileSession(sql, ARGS, spawner, { schedule }),
    ).resolves.toBe('recreating');

    expect(schedule).toHaveBeenCalledExactlyOnceWith(dataSql, ARGS);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it.each(['agent', 'agent-light'] as const)(
    'recreates a gone pinned %s session under its id in the queued job, waiting for the lock, then re-pins it [SBX-R10]',
    async (profile) => {
      const { sql, locks, data, stored, end } = fakeSql({
        ...PINNED_SESSION,
        profile,
      });
      const { spawner, calls } = fakeSpawner(false);

      await expect(recreatePinnedSession(sql, ARGS, spawner)).resolves.toBe(
        'recreated',
      );

      // The create path the agent hosts use, under the SAME id and
      // organization: the spawner resolves the workspace by id, so this create
      // re-attaches the preserved one. The pin follows it, since a create
      // always starts unpinned spawner-side.
      expect(spawner.create).toHaveBeenCalledExactlyOnceWith({
        sessionId: 'session-a',
        organizationId: 'org-a',
        profile,
        placement: 'device',
        workload: 'project',
      });
      expect(calls).toEqual([
        'isAlive session-a',
        'create session-a',
        'setPinned session-a true',
      ]);
      expect(addJobInTx).not.toHaveBeenCalled();
      expectLockedOnce(locks, end, 'wait');
      expectRowUntouched(data, stored);
    },
  );

  it('heals a gone pinned render sandbox instead of recreating it [SBX-R10]', async () => {
    const { sql, stored } = fakeSql({
      ...PINNED_SESSION,
      profile: 'default',
      ownerType: 'render',
    });
    const { spawner } = fakeSpawner(false);

    await expect(recreatePinnedSession(sql, ARGS, spawner)).resolves.toBe(
      'healed',
    );

    expect(spawner.create).not.toHaveBeenCalled();
    expect(spawner.setPinned).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(stored?.status).toBe('destroyed');
  });

  it('re-pins a live pinned render sandbox', async () => {
    const { sql } = fakeSql({
      ...PINNED_SESSION,
      profile: 'default',
      ownerType: 'render',
    });
    const { spawner, calls } = fakeSpawner(true);

    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe(
      'repinned',
    );

    expect(calls).toEqual(['isAlive session-a', 'setPinned session-a true']);
  });

  it.each([
    ['queued', undefined],
    ['recreated', 'inline' as const],
  ])(
    'refuses a gone pinned row with no known profile (%s) and leaves it untouched',
    async (_label, recreate) => {
      const { sql, data, stored } = fakeSql({
        ...PINNED_SESSION,
        profile: null,
      });
      const { spawner } = fakeSpawner(false);

      await expect(
        reconcileSession(
          sql,
          ARGS,
          spawner,
          recreate === undefined ? {} : { recreate },
        ),
      ).rejects.toThrow(/carries no known profile/);

      expect(spawner.create).not.toHaveBeenCalled();
      expect(spawner.setPinned).not.toHaveBeenCalled();
      expect(addJobInTx).not.toHaveBeenCalled();
      expectRowUntouched(data, stored);
      expect(stored?.pinned).toBe(true);
    },
  );

  it.each(['active', 'creating'])(
    'only re-pins a pinned row reading %s whose session the spawner reports as already back (a duplicate create)',
    async (status) => {
      const { sql, data, stored } = fakeSql({ ...PINNED_SESSION, status });
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const { spawner, calls } = fakeSpawner(false, {
        create: vi.fn(() =>
          Promise.reject(new SessionDuplicateError('session-a')),
        ),
      });

      // Not `recreated`: whoever brought it back (a turn, its host) owns
      // the create and its row — a `creating` row stays for its host to flip.
      await expect(recreatePinnedSession(sql, ARGS, spawner)).resolves.toBe(
        'repinned',
      );

      expect(calls).toEqual(['isAlive session-a', 'setPinned session-a true']);
      expect(warn).toHaveBeenCalledOnce();
      expectRowUntouched(data, stored, status);
      warn.mockRestore();
    },
  );

  it('flips a pinned row its host left `creating` to active once the recreate answers, before the pin', async () => {
    const { sql, data, order, stored } = fakeSql({
      ...PINNED_SESSION,
      status: 'creating',
    });
    let statusAtPin: unknown;
    const { spawner } = fakeSpawner(
      false,
      {
        setPinned: vi.fn((sessionId: string, pinned: boolean) => {
          order.push(`setPinned ${sessionId} ${pinned}`);
          statusAtPin = stored?.status;
          // A refused pin must not strand the ready container as `creating`.
          return Promise.resolve(false);
        }),
      },
      order,
    );

    await expect(recreatePinnedSession(sql, ARGS, spawner)).rejects.toThrow(
      /did not take the pin of session-a after recreating it/,
    );

    expect(statusAtPin).toBe('active');
    expect(stored?.status).toBe('active');
    expect(order.slice(-3)).toEqual([
      'create session-a',
      'data:UPDATE',
      'setPinned session-a true',
    ]);
    const flip = data.find((statement) => statement.text.startsWith('UPDATE'));
    expect(flip?.text).toMatch(
      /WHERE id = \? AND org_id = \? AND status = 'creating'/,
    );
    expect(flip?.values.slice(-2)).toEqual(['row-a', 'org-a']);
    expect(revokeSessionGatewayKeys).not.toHaveBeenCalled();
  });

  it('leaves the row for the next visit when the spawner cannot recreate the session', async () => {
    const { sql, data, stored } = fakeSql(PINNED_SESSION);
    const failure = new Error('sandbox session create failed (503): full');
    const { spawner } = fakeSpawner(false, {
      create: vi.fn(() => Promise.reject(failure)),
    });

    await expect(recreatePinnedSession(sql, ARGS, spawner)).rejects.toBe(
      failure,
    );

    expect(spawner.setPinned).not.toHaveBeenCalled();
    expectRowUntouched(data, stored);
  });

  it.each([
    ['a live', true],
    ['a recreated', false],
  ])(
    'throws when the spawner does not take the pin of %s session',
    async (_label, alive) => {
      const { sql, data, stored } = fakeSql(PINNED_SESSION);
      const { spawner } = fakeSpawner(alive, {
        setPinned: vi.fn(() => Promise.resolve(false)),
      });

      await expect(recreatePinnedSession(sql, ARGS, spawner)).rejects.toThrow(
        /did not take the pin of session-a/,
      );

      expect(spawner.setPinned).toHaveBeenCalledExactlyOnceWith(
        'session-a',
        true,
      );
      expectRowUntouched(data, stored);
    },
  );

  it.each(['destroyed', 'stopped', 'expired'])(
    'leaves a pinned row that reads %s alone without asking the spawner',
    async (status) => {
      const { sql, locks, stored } = fakeSql({ ...PINNED_SESSION, status });
      const { spawner, calls } = fakeSpawner(false);

      await expect(recreatePinnedSession(sql, ARGS, spawner)).resolves.toBe(
        'skipped',
      );

      expect(calls).toEqual([]);
      expect(locks).toEqual([]);
      expect(postgresFactory).not.toHaveBeenCalled();
      expect(stored?.status).toBe(status);
    },
  );

  it('leaves a pinned row that turned stopped between the first look and the lock alone', async () => {
    const { sql, data, stored } = fakeSql(PINNED_SESSION);
    const { spawner } = fakeSpawner(false, {
      isAlive: vi.fn(() => {
        if (stored !== null) stored.status = 'stopped';
        return Promise.resolve(false);
      }),
    });

    await expect(recreatePinnedSession(sql, ARGS, spawner)).resolves.toBe(
      'skipped',
    );

    expect(spawner.create).not.toHaveBeenCalled();
    expect(spawner.setPinned).not.toHaveBeenCalled();
    expectRowUntouched(data, stored, 'stopped');
  });

  it('skips a session whose lock another transition holds, without waiting or opening a connection', async () => {
    const { sql, locks, stored } = fakeSql(PINNED_SESSION, {
      lockFree: false,
    });
    const { spawner, calls } = fakeSpawner(false);

    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe('skipped');

    expect(locks).toHaveLength(1);
    expect(locks[0]?.text).toContain('pg_try_advisory_xact_lock');
    expect(postgresFactory).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(stored).toMatchObject({ status: 'active', pinned: true });
  });
});

describe('reconcileSession heals unpinned phantoms as before', () => {
  it('leaves a live unpinned session alone without taking the lock', async () => {
    const { sql, root, locks, data, stored } = fakeSql(OWNED_SESSION);
    const { spawner, calls } = fakeSpawner(true);

    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe('live');

    expect(calls).toEqual(['isAlive session-a']);
    expect(root).toHaveLength(1);
    expect(locks).toEqual([]);
    expect(data).toEqual([]);
    expect(postgresFactory).not.toHaveBeenCalled();
    expectRowUntouched(root, stored);
  });

  it('settles a gone unpinned session as destroyed under the lock without recreating it', async () => {
    const { sql, dataSql, locks, stored, end } = fakeSql(OWNED_SESSION);
    const { spawner, calls } = fakeSpawner(false);

    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe('healed');

    // Probed again under the lock: the first answer may predate a
    // transition that just finished.
    expect(calls).toEqual(['isAlive session-a', 'isAlive session-a']);
    expect(spawner.create).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(stored?.status).toBe('destroyed');
    expectLockedOnce(locks, end, 'try');
    expect(revokeSessionGatewayKeys).toHaveBeenCalledExactlyOnceWith(
      dataSql,
      ARGS,
    );
    expect(wakeParkedAgentRuns).toHaveBeenCalledExactlyOnceWith(
      dataSql,
      'org-a',
    );
  });

  it('counts nothing for a row a Destroy settled while the reconcile waited', async () => {
    const { sql, data, stored } = fakeSql(OWNED_SESSION);
    let probes = 0;
    const { spawner } = fakeSpawner(false, {
      isAlive: vi.fn(() => {
        probes += 1;
        // The Destroy that held the lock committed its settlement.
        if (probes === 2 && stored !== null) stored.status = 'destroyed';
        return Promise.resolve(false);
      }),
    });

    await expect(recreatePinnedSession(sql, ARGS, spawner)).resolves.toBe(
      'skipped',
    );

    expectRowUntouched(data, stored, 'destroyed');
  });

  it.each(['stopped', 'expired', 'destroyed'])(
    'leaves an unpinned row that reads %s alone, even when the spawner has no container',
    async (status) => {
      const { sql, root, stored } = fakeSql({ ...OWNED_SESSION, status });
      const { spawner, calls } = fakeSpawner(false);

      await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe(
        'skipped',
      );

      expect(calls).toEqual([]);
      expectRowUntouched(root, stored, status);
    },
  );

  it('keeps a workspace hibernated between the first look and the lock', async () => {
    const { sql, data, stored } = fakeSql(OWNED_SESSION);
    let probes = 0;
    const { spawner } = fakeSpawner(false, {
      isAlive: vi.fn(() => {
        probes += 1;
        if (probes === 1 && stored !== null) stored.status = 'stopped';
        return Promise.resolve(false);
      }),
    });

    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe('skipped');

    expectRowUntouched(data, stored, 'stopped');
  });
});

describe('reconcileSession keeps an agent workspace whose sandbox disappeared [SBX-R17]', () => {
  const held = (sessionId: string) => ({
    backend: 'docker' as const,
    workspaces: [{ sessionId, touchedAtMs: 1, active: false, pinned: false }],
    organizations: [],
  });

  it.each(['agent', 'agent-light'])(
    'settles a gone %s session whose workspace the spawner holds as stopped, reclaiming its credentials',
    async (profile) => {
      const { sql, dataSql, data, stored } = fakeSql({
        ...OWNED_SESSION,
        profile,
      });
      const inventory = vi.fn(async () => held('session-a'));
      const { spawner } = fakeSpawner(false, { inventory });

      await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe(
        'healed',
      );

      expect(inventory).toHaveBeenCalledOnce();
      expect(stored?.status).toBe('stopped');
      expect(spawner.create).not.toHaveBeenCalled();
      // Under the organization's admission lock, like every release.
      expect(data.map((statement) => statement.text).slice(-2)).toEqual([
        expect.stringContaining('pg_advisory_xact_lock'),
        expect.stringContaining("SET status = 'stopped'"),
      ]);
      expect(revokeSessionGatewayKeys).toHaveBeenCalledExactlyOnceWith(
        dataSql,
        { ...ARGS, rowId: 'row-a' },
      );
      expect(wakeParkedAgentRuns).toHaveBeenCalledExactlyOnceWith(
        dataSql,
        'org-a',
      );
    },
  );

  it('keeps the workspace when the inventory cannot be read', async () => {
    for (const inventory of [
      vi.fn(async () => {
        throw new Error('sandbox workspace inventory unavailable (503)');
      }),
      vi.fn(async () => null),
    ]) {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { sql, stored } = fakeSql(OWNED_SESSION);
      const { spawner } = fakeSpawner(false, { inventory });

      await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe(
        'healed',
      );

      expect(stored?.status).toBe('stopped');
    }
  });

  it('settles as destroyed when the spawner holds no workspace under the id', async () => {
    const { sql, stored } = fakeSql(OWNED_SESSION);
    const { spawner } = fakeSpawner(false, {
      inventory: vi.fn(async () => held('another-session')),
    });

    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe('healed');

    expect(stored?.status).toBe('destroyed');
  });

  it('settles a gone render session as destroyed without asking for the inventory', async () => {
    const { sql, stored } = fakeSql({
      ...OWNED_SESSION,
      profile: 'default',
      ownerType: 'render',
    });
    const inventory = vi.fn(async () => held('session-a'));
    const { spawner } = fakeSpawner(false, { inventory });

    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe('healed');

    expect(stored?.status).toBe('destroyed');
    expect(inventory).not.toHaveBeenCalled();
  });

  // The inventory is read under the session's lifecycle lock: the read is
  // bounded on its own, and stops with the pass that asked for it.
  it('bounds the inventory read, which a pass out of time ends without settling the row', async () => {
    const pass = new AbortController();
    const { sql, stored } = fakeSql(OWNED_SESSION);
    const inventory = vi.fn(async (options?: { signal?: AbortSignal }) => {
      expect(options?.signal?.aborted).toBe(false);
      pass.abort();
      options?.signal?.throwIfAborted();
      return held('session-a');
    });
    const { spawner } = fakeSpawner(false, { inventory });

    await expect(
      reconcileSession(sql, ARGS, spawner, { signal: pass.signal }),
    ).rejects.toThrow();

    expect(inventory).toHaveBeenCalledOnce();
    expect(stored?.status).toBe('active');
    expect(revokeSessionGatewayKeys).not.toHaveBeenCalled();
    expect(wakeParkedAgentRuns).not.toHaveBeenCalled();
  });

  it('reads an inventory that times out on its own as unknown, keeping the workspace', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pass = new AbortController();
    const { sql, stored } = fakeSql(OWNED_SESSION);
    const inventory = vi.fn(async (options?: { signal?: AbortSignal }) => {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    const { spawner } = fakeSpawner(false, { inventory });

    await expect(
      reconcileSession(sql, ARGS, spawner, { signal: pass.signal }),
    ).resolves.toBe('healed');

    expect(stored?.status).toBe('stopped');
  });

  it('leaves a row pinned meanwhile to its next visit, settling and revoking nothing', async () => {
    const { sql, stored } = fakeSql(OWNED_SESSION);
    const { spawner } = fakeSpawner(false, {
      inventory: vi.fn(async () => {
        // A pin taken meanwhile keeps the row from being hibernated.
        if (stored !== null) stored.pinned = true;
        return held('session-a');
      }),
    });

    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe('skipped');

    expect(stored?.status).toBe('active');
    expect(revokeSessionGatewayKeys).not.toHaveBeenCalled();
    expect(wakeParkedAgentRuns).not.toHaveBeenCalled();
  });
});

describe('every lifecycle transition takes the session lock first', () => {
  // `order` interleaves the three connections and the spawner: nothing but
  // the reconcile's unlocked first look may run before the advisory lock,
  // and the data client opens only once the lock is held.
  it('reconcile: after the first look, the tried lock precedes the probe, the fresh read and the pin', async () => {
    const { sql, order } = fakeSql(PINNED_SESSION);
    const { spawner } = fakeSpawner(true, {}, order);

    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe(
      'repinned',
    );

    expect(order).toEqual([
      'root:SELECT',
      'lock:try-lock',
      'connect',
      'isAlive session-a',
      'data:SELECT',
      'setPinned session-a true',
    ]);
  });

  it('recreate job: the waited-for lock precedes the probe, the fresh read, the create and the pin', async () => {
    const { sql, order } = fakeSql(PINNED_SESSION);
    const { spawner } = fakeSpawner(false, {}, order);

    await expect(recreatePinnedSession(sql, ARGS, spawner)).resolves.toBe(
      'recreated',
    );

    expect(order).toEqual([
      'root:SELECT',
      'lock:lock',
      'connect',
      'isAlive session-a',
      'data:SELECT',
      'create session-a',
      'setPinned session-a true',
    ]);
  });

  it('pin: the lock precedes the row write and the spawner patch', async () => {
    const { sql, order } = fakeSql(OWNED_SESSION);
    vi.mocked(sessionSetPinned).mockImplementationOnce(
      async (sessionId, pinned) => {
        order.push(`setPinned ${sessionId} ${pinned}`);
        return true;
      },
    );

    await expect(pinSession(sql, { ...ARGS, pinned: true })).resolves.toBe(
      true,
    );

    expect(order).toEqual([
      'lock:lock',
      'connect',
      'data:UPDATE',
      'data:SELECT',
      'setPinned session-a true',
    ]);
  });

  it('destroy: the lock precedes the read, both unpins, the delete and the settlement', async () => {
    const { sql, order } = fakeSql(PINNED_SESSION);
    vi.mocked(sessionSetPinned).mockImplementationOnce(
      async (sessionId, pinned) => {
        order.push(`setPinned ${sessionId} ${pinned}`);
        return true;
      },
    );
    vi.mocked(sessionDestroy).mockImplementationOnce(async (sessionId) => {
      order.push(`destroy ${sessionId}`);
      return true;
    });

    await expect(teardownSession(sql, ARGS)).resolves.toBe(true);

    expect(order.slice(0, 6)).toEqual([
      'lock:lock',
      'connect',
      'data:SELECT',
      'data:UPDATE',
      'setPinned session-a false',
      'destroy session-a',
    ]);
    // The settlement (row flip + token revocation) runs on the data client.
    expect(order.slice(6).every((entry) => entry.startsWith('data:'))).toBe(
      true,
    );
    expect(order.slice(6)).toContain('data:UPDATE');
  });
});

describe('durable desired pin delivery', () => {
  it.each(['false', 'throw'] as const)(
    'recovers a failed Unpin (%s), even after ordinary reconciliation skipped it',
    async (failure) => {
      const { sql, stored } = fakeSql({ ...OWNED_SESSION, pinned: true });
      if (failure === 'false')
        vi.mocked(sessionSetPinned).mockResolvedValueOnce(false);
      else
        vi.mocked(sessionSetPinned).mockRejectedValueOnce(
          new Error('device offline'),
        );
      await expect(pinSession(sql, { ...ARGS, pinned: false })).rejects.toThrow(
        failure === 'false' ? 'did not confirm pin=false' : 'device offline',
      );
      expect(stored?.pinned).toBe(false);
      expect(addJobInTx).toHaveBeenCalledOnce();
      const { spawner } = fakeSpawner(true);
      await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe('live');
      expect(spawner.setPinned).not.toHaveBeenCalled();
      await syncSessionPin(sql, { ...ARGS, rowId: 'row-a' }, spawner);
      expect(spawner.setPinned).toHaveBeenCalledExactlyOnceWith(
        'session-a',
        false,
      );
      expect(addJobInTx).toHaveBeenCalledOnce();
    },
  );

  it('applies the latest desired value instead of replaying an earlier toggle', async () => {
    const { sql } = fakeSql({ ...OWNED_SESSION, pinned: true });
    const { spawner } = fakeSpawner(true);
    await syncSessionPin(sql, { ...ARGS, rowId: 'row-a' }, spawner);
    expect(spawner.setPinned).toHaveBeenCalledExactlyOnceWith(
      'session-a',
      true,
    );
  });

  it.each(['false', 'throw'] as const)(
    'keeps durable work after a sync failure (%s)',
    async (failure) => {
      const { sql } = fakeSql(OWNED_SESSION);
      const { spawner } = fakeSpawner(true, {
        setPinned: vi.fn(async () => {
          if (failure === 'throw') throw new Error('device offline');
          return false;
        }),
      });
      const before = Date.now();
      await syncSessionPin(sql, { ...ARGS, rowId: 'row-a' }, spawner);
      expect(addJobInTx).toHaveBeenCalledWith(
        sql,
        'sandbox.sync_pin',
        { ...ARGS, rowId: 'row-a' },
        {
          singletonKey: JSON.stringify(['org-a', 'session-a', 'row-a']),
          startAfter: expect.any(Date),
        },
      );
      const options = vi.mocked(addJobInTx).mock.calls.at(-1)?.[3];
      expect(options?.startAfter?.getTime()).toBeGreaterThanOrEqual(
        before + 60_000,
      );
    },
  );

  it('propagates a failed retry enqueue so the queue retries the attempt', async () => {
    const { sql } = fakeSql(OWNED_SESSION);
    const { spawner } = fakeSpawner(true, {
      setPinned: vi.fn(async () => false),
    });
    vi.mocked(addJobInTx).mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    await expect(
      syncSessionPin(sql, { ...ARGS, rowId: 'row-a' }, spawner),
    ).rejects.toThrow('database unavailable');
  });

  it('never patches another incarnation or a destroyed row', async () => {
    for (const row of [
      { ...OWNED_SESSION, id: 'replacement' },
      { ...OWNED_SESSION, status: 'destroyed' },
    ]) {
      const { sql } = fakeSql(row);
      const { spawner } = fakeSpawner(true);
      await syncSessionPin(sql, { ...ARGS, rowId: 'row-a' }, spawner);
      expect(spawner.setPinned).not.toHaveBeenCalled();
    }
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('still delivers a failed Unpin after the database allocation expired', async () => {
    const { sql } = fakeSql({ ...OWNED_SESSION, status: 'expired' });
    const { spawner } = fakeSpawner(true);
    await syncSessionPin(sql, { ...ARGS, rowId: 'row-a' }, spawner);
    expect(spawner.setPinned).toHaveBeenCalledExactlyOnceWith(
      'session-a',
      false,
    );
  });

  it('finishes a refused patch when compute is definitively gone', async () => {
    const { sql } = fakeSql(OWNED_SESSION);
    const { spawner } = fakeSpawner(false, {
      setPinned: vi.fn(async () => false),
    });
    await syncSessionPin(sql, { ...ARGS, rowId: 'row-a' }, spawner);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('does not patch remotely when the atomic delivery enqueue fails', async () => {
    const { sql } = fakeSql(OWNED_SESSION);
    vi.mocked(addJobInTx).mockRejectedValueOnce(new Error('cannot enqueue'));
    await expect(pinSession(sql, { ...ARGS, pinned: true })).rejects.toThrow(
      'cannot enqueue',
    );
    expect(sessionSetPinned).not.toHaveBeenCalled();
  });
});

describe('historical runtime pin drift', () => {
  it.each(['stopped', 'expired'])(
    'finishes an unpublished Unpin on a %s workspace through the production observation shape',
    async (status) => {
      const { sql, stored } = fakeSql({ ...OWNED_SESSION, status });
      const observe = vi.fn(async () => ({
        pinned: false,
        pinSynchronized: false,
      }));
      const { spawner } = fakeSpawner(true, { observe });
      await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe(
        'unpinned',
      );
      expect(observe).toHaveBeenCalledTimes(2);
      expect(spawner.isAlive).not.toHaveBeenCalled();
      expect(spawner.setPinned).toHaveBeenCalledExactlyOnceWith(
        'session-a',
        false,
      );
      expect(addJobInTx).toHaveBeenCalledOnce();
      expect(stored?.status).toBe(status);
      expect(spawner.create).not.toHaveBeenCalled();
      expect(revokeSessionGatewayKeys).not.toHaveBeenCalled();
    },
  );

  it.each(['active', 'stopped', 'expired'])(
    'repairs a stale pin on the current %s incarnation and persists retry work',
    async (status) => {
      const { sql, stored } = fakeSql({ ...OWNED_SESSION, status });
      const observe = vi.fn(async () => ({ pinned: true }));
      const { spawner } = fakeSpawner(true, { observe });
      await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe(
        'unpinned',
      );
      expect(observe).toHaveBeenCalledTimes(2); // unlocked look, then locked revalidation
      expect(spawner.isAlive).not.toHaveBeenCalled();
      expect(spawner.setPinned).toHaveBeenCalledExactlyOnceWith(
        'session-a',
        false,
      );
      expect(addJobInTx).toHaveBeenCalledWith(
        expect.anything(),
        'sandbox.sync_pin',
        { ...ARGS, rowId: 'row-a' },
        expect.anything(),
      );
      expect(stored?.status).toBe(status);
      expect(revokeSessionGatewayKeys).not.toHaveBeenCalled();
      expect(spawner.create).not.toHaveBeenCalled();
    },
  );

  it.each(['stopped', 'expired'])(
    'preserves a %s workspace when runtime is absent or carries no pin metadata',
    async (status) => {
      for (const runtime of [
        { alive: false },
        { alive: true },
        { alive: true, pinned: false },
      ]) {
        const { sql, stored } = fakeSql({ ...OWNED_SESSION, status });
        const { spawner } = fakeSpawner(runtime.alive, {
          observe: vi.fn(async () => (runtime.alive ? runtime : null)),
        });
        await reconcileSession(sql, ARGS, spawner);
        expect(stored?.status).toBe(status);
        expect(spawner.setPinned).not.toHaveBeenCalled();
        expect(spawner.create).not.toHaveBeenCalled();
      }
      expect(addJobInTx).not.toHaveBeenCalled();
      expect(revokeSessionGatewayKeys).not.toHaveBeenCalled();
    },
  );

  it('leaves a refused historical unpin durably queued', async () => {
    const { sql } = fakeSql(OWNED_SESSION);
    const { spawner } = fakeSpawner(true, {
      observe: vi.fn(async () => ({ pinned: true })),
      setPinned: vi.fn(async () => false),
    });
    await expect(reconcileSession(sql, ARGS, spawner)).rejects.toThrow(
      'did not remove the pin',
    );
    expect(addJobInTx).toHaveBeenCalledOnce();
  });

  it('rechecks desired pin after acquiring the lifecycle lock', async () => {
    const { sql, stored } = fakeSql(OWNED_SESSION);
    let reads = 0;
    const { spawner } = fakeSpawner(true, {
      observe: vi.fn(async () => {
        reads += 1;
        if (reads === 2 && stored !== null) stored.pinned = true;
        return { pinned: true };
      }),
    });
    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe('live');
    expect(spawner.setPinned).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});
