// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SessionDuplicateError,
  sessionDestroy,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import { wakeParkedAgentRuns } from '../tasks/agent-runs.ts';
import { revokeSessionGatewayKeys } from './gateway-keys.ts';
import {
  reconcileSession,
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

/** Exercise the real scoped lookup and settlement; only the SQL transport is
 * scripted. The SELECT's bound organization and id must both match the row. */
function fakeSql(row: SessionRow | null) {
  const statements: Statement[] = [];
  const stored = row === null ? null : { ...row };
  const query = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT pg_advisory_xact_lock')) {
      return Promise.resolve([]);
    }
    if (text.startsWith('SELECT')) {
      const matches =
        stored !== null &&
        values.at(-2) === stored.sessionId &&
        values.at(-1) === stored.organizationId;
      return Promise.resolve(matches ? [stored] : []);
    }
    if (text.startsWith('UPDATE app.sandbox_sessions')) {
      if (
        stored === null ||
        stored.status === 'destroyed' ||
        !values.includes(stored.sessionId) ||
        !values.includes(stored.organizationId)
      )
        return Promise.resolve([]);
      if (text.includes('pinned =')) stored.pinned = Boolean(values[0]);
      else stored.status = 'destroyed';
      return Promise.resolve([{ id: stored.id }]);
    }
    return Promise.resolve([]);
  };
  // A postgres.js transaction really has savepoint and NO begin. Keeping
  // that distinction catches accidental nested root-pool transactions.
  const tx = Object.assign(query, {
    unsafe: (fragment: string) => fragment,
    savepoint: <T>(callback: (transaction: typeof query) => Promise<T>) =>
      callback(tx),
  });
  const sql = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) =>
      query(strings, ...values),
    {
      unsafe: tx.unsafe,
      options: { host: ['itest-host'], ssl: 'require', max: 3 },
      end: vi.fn(async () => {}),
      begin: <T>(callback: (transaction: typeof query) => Promise<T>) =>
        callback(tx),
    },
  );
  postgresFactory.mockReturnValue(sql);
  return { sql: sql as unknown as Sql, tx, statements, stored, end: sql.end };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionDestroy).mockResolvedValue(true);
});

describe('teardownSession ownership and confirmed deletion', () => {
  it.each([
    ['another organization', { ...OWNED_SESSION, organizationId: 'org-b' }],
    ['no organization', null],
  ])('does not touch a session belonging to %s', async (_label, row) => {
    const { sql, statements, stored } = fakeSql(row);

    expect(
      await teardownSession(sql, {
        organizationId: 'org-a',
        sessionId: 'session-a',
      }),
    ).toBe(false);

    expect(statements).toHaveLength(2);
    expect(statements[1]?.text).toContain(
      'WHERE session_id = ? AND org_id = ?',
    );
    expect(statements[1]?.values.slice(-2)).toEqual(['session-a', 'org-a']);
    expect(sessionDestroy).not.toHaveBeenCalled();
    expect(revokeSessionGatewayKeys).not.toHaveBeenCalled();
    expect(wakeParkedAgentRuns).not.toHaveBeenCalled();
    expect(stored?.status).toBe(row?.status);
  });

  it.each([true, false])(
    'settles an owned session after confirmed deletion or absence (%s)',
    async (destroyed) => {
      const { sql, end, statements, stored } = fakeSql(OWNED_SESSION);
      let stateAtDestroy: unknown;
      vi.mocked(sessionDestroy).mockImplementationOnce(async () => {
        stateAtDestroy = {
          statements: statements.length,
          status: stored?.status,
          revocations: vi.mocked(revokeSessionGatewayKeys).mock.calls.length,
        };
        return destroyed;
      });
      const args = { organizationId: 'org-a', sessionId: 'session-a' };

      await expect(teardownSession(sql, args)).resolves.toBe(true);

      expect(sessionDestroy).toHaveBeenCalledExactlyOnceWith('session-a');
      expect(stateAtDestroy).toEqual({
        statements: 3,
        status: 'active',
        revocations: 0,
      });
      expect(stored?.status).toBe('destroyed');
      expect(postgresFactory).toHaveBeenCalledExactlyOnceWith({
        host: ['itest-host'],
        ssl: 'require',
        max: 1,
      });
      expect(end).toHaveBeenCalledOnce();
      expect(revokeSessionGatewayKeys).toHaveBeenCalledExactlyOnceWith(
        sql,
        args,
      );
      expect(wakeParkedAgentRuns).toHaveBeenCalledExactlyOnceWith(sql, 'org-a');
    },
  );

  it('leaves an owned session retryable when the spawner cannot confirm deletion', async () => {
    const { sql, end, statements, stored } = fakeSql({
      ...OWNED_SESSION,
      pinned: true,
    });
    const failure = new Error('sandbox session destroy failed (503)');
    vi.mocked(sessionDestroy).mockRejectedValueOnce(failure);

    await expect(
      teardownSession(sql, {
        organizationId: 'org-a',
        sessionId: 'session-a',
      }),
    ).rejects.toBe(failure);

    expect(statements).toHaveLength(3);
    expect(stored?.status).toBe('active');
    expect(stored?.pinned).toBe(false);
    expect(end).toHaveBeenCalledOnce();
    expect(revokeSessionGatewayKeys).not.toHaveBeenCalled();
    expect(wakeParkedAgentRuns).not.toHaveBeenCalled();
  });
});

/** The reconcile's spawner, scripted: its liveness answer is fixed, and every
 * verb it is asked for lands on one ordered log. */
function fakeSpawner(
  alive: boolean,
  overrides: Partial<ReconcileSpawner> = {},
): { spawner: ReconcileSpawner; calls: string[] } {
  const calls: string[] = [];
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
  it('re-asserts the pin on a live pinned session and settles nothing', async () => {
    const { sql, statements, stored } = fakeSql(PINNED_SESSION);
    const { spawner, calls } = fakeSpawner(true);

    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe(
      'repinned',
    );

    expect(calls).toEqual(['isAlive session-a', 'setPinned session-a true']);
    expect(spawner.create).not.toHaveBeenCalled();
    expectRowUntouched(statements, stored);
  });

  it('recreates a gone pinned session under its id, then re-pins it, instead of settling the row', async () => {
    const { sql, statements, stored } = fakeSql(PINNED_SESSION);
    const { spawner, calls } = fakeSpawner(false);

    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe(
      'recreated',
    );

    // The create path the agent hosts use, under the SAME id and
    // organization: the spawner resolves the workspace by id, so this create
    // re-attaches the preserved one. The pin follows it, since a create
    // always starts unpinned spawner-side.
    expect(spawner.create).toHaveBeenCalledExactlyOnceWith({
      sessionId: 'session-a',
      organizationId: 'org-a',
      profile: 'agent',
      placement: 'device',
    });
    expect(calls).toEqual([
      'isAlive session-a',
      'create session-a',
      'setPinned session-a true',
    ]);
    expectRowUntouched(statements, stored);
  });

  it('recreates a pinned render sandbox on the server', async () => {
    const { sql } = fakeSql({
      ...PINNED_SESSION,
      profile: 'default',
      ownerType: 'render',
    });
    const { spawner } = fakeSpawner(false);

    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe(
      'recreated',
    );

    expect(spawner.create).toHaveBeenCalledExactlyOnceWith({
      sessionId: 'session-a',
      organizationId: 'org-a',
      profile: 'default',
      placement: 'server',
    });
  });

  it('re-pins a session the spawner reports as already back (a duplicate create)', async () => {
    const { sql, statements, stored } = fakeSql(PINNED_SESSION);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { spawner, calls } = fakeSpawner(false, {
      create: vi.fn(() =>
        Promise.reject(new SessionDuplicateError('session-a')),
      ),
    });

    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe(
      'recreated',
    );

    expect(calls).toEqual(['isAlive session-a', 'setPinned session-a true']);
    expect(warn).toHaveBeenCalledOnce();
    expectRowUntouched(statements, stored);
    warn.mockRestore();
  });

  it('leaves the row for the next visit when the spawner cannot recreate the session', async () => {
    const { sql, statements, stored } = fakeSql(PINNED_SESSION);
    const failure = new Error('sandbox session create failed (503): full');
    const { spawner } = fakeSpawner(false, {
      create: vi.fn(() => Promise.reject(failure)),
    });

    await expect(reconcileSession(sql, ARGS, spawner)).rejects.toBe(failure);

    expect(spawner.setPinned).not.toHaveBeenCalled();
    expectRowUntouched(statements, stored);
  });

  it.each([
    ['a live', true],
    ['a recreated', false],
  ])(
    'throws when the spawner does not take the pin of %s session',
    async (_label, alive) => {
      const { sql, statements, stored } = fakeSql(PINNED_SESSION);
      const { spawner } = fakeSpawner(alive, {
        setPinned: vi.fn(() => Promise.resolve(false)),
      });

      await expect(reconcileSession(sql, ARGS, spawner)).rejects.toThrow(
        /did not take the pin of session-a/,
      );

      expect(spawner.setPinned).toHaveBeenCalledExactlyOnceWith(
        'session-a',
        true,
      );
      expectRowUntouched(statements, stored);
    },
  );

  it.each(['destroyed', 'stopped'])(
    'leaves a pinned row that turned %s since the batch named it alone',
    async (status) => {
      const { sql, statements, stored } = fakeSql({
        ...PINNED_SESSION,
        status,
      });
      const { spawner } = fakeSpawner(false);

      await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe(
        'skipped',
      );

      expect(spawner.create).not.toHaveBeenCalled();
      expect(spawner.setPinned).not.toHaveBeenCalled();
      expectRowUntouched(statements, stored, status);
    },
  );
});

describe('reconcileSession heals unpinned phantoms as before', () => {
  it('leaves a live unpinned session alone', async () => {
    const { sql, statements, stored } = fakeSql(OWNED_SESSION);
    const { spawner, calls } = fakeSpawner(true);

    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe('live');

    expect(calls).toEqual(['isAlive session-a']);
    expectRowUntouched(statements, stored);
  });

  it('settles a gone unpinned session as destroyed without recreating it', async () => {
    const { sql, stored } = fakeSql(OWNED_SESSION);
    const { spawner, calls } = fakeSpawner(false);

    await expect(reconcileSession(sql, ARGS, spawner)).resolves.toBe('healed');

    expect(calls).toEqual(['isAlive session-a']);
    expect(stored?.status).toBe('destroyed');
    expect(revokeSessionGatewayKeys).toHaveBeenCalledExactlyOnceWith(sql, ARGS);
    expect(wakeParkedAgentRuns).toHaveBeenCalledExactlyOnceWith(sql, 'org-a');
  });
});
