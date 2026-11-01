// @vitest-environment node

/**
 * Light sandboxes: one per owner under a deterministic id, reused while it
 * lives, created fresh when it is gone, and — when the organization's light
 * budget is full — given the slot of the least recently used idle one. A
 * busy budget or host is a `LightSandboxBusyError`, never a hang; a host
 * that cannot start one says why, as a `LightSandboxUnavailableError`.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SpawnerBusyError,
  SpawnerUnreachableError,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import {
  acquireLightSession,
  destroyLightSession,
  LIGHT_SESSION_IDLE_MS,
  LightSandboxBusyError,
  LightSandboxUnavailableError,
  lightSessionId,
  releaseIdleLightSessions,
  releaseLightSession,
  type LightSessionSpawner,
} from './light-sessions.ts';
import {
  getSessionBySessionId,
  markSessionDestroyed,
  reserveSessionSlot,
  SandboxQuotaError,
  setSessionStatus,
} from './sessions.ts';

vi.mock('../../core/node_only/sandbox/helpers/session_client.ts', () => {
  class MockSpawnerBusyError extends Error {
    readonly retryAfterMs: number | undefined;
    readonly refusal: string | undefined;
    constructor(retryAfterMs?: number, _queue?: unknown, refusal?: string) {
      super('busy');
      this.retryAfterMs = retryAfterMs;
      this.refusal = refusal;
    }
  }
  class MockSpawnerUnreachableError extends Error {}
  return {
    SpawnerBusyError: MockSpawnerBusyError,
    SpawnerUnreachableError: MockSpawnerUnreachableError,
    sessionCreate: vi.fn(),
    sessionDestroy: vi.fn(),
    sessionDestroyIfIdle: vi.fn(),
    sessionIsAlive: vi.fn(),
  };
});
vi.mock('./sessions.ts', () => {
  class MockSandboxQuotaError extends Error {
    readonly reason: string | undefined;
    constructor(message: string, reason?: string) {
      super(message);
      this.reason = reason;
    }
  }
  return {
    SandboxQuotaError: MockSandboxQuotaError,
    getSessionBySessionId: vi.fn(),
    markSessionDestroyed: vi.fn(() => Promise.resolve(true)),
    reserveSessionSlot: vi.fn(() => Promise.resolve('row-1')),
    setSessionStatus: vi.fn(() => Promise.resolve(true)),
  };
});

const ORG = 'org_1';
const OWNER = { organizationId: ORG, ownerKey: 'thread-1', createdBy: 'u1' };

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(lru: { sessionId: string }[][] = []): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes('SELECT session_id AS "sessionId"')) {
      return Promise.resolve(lru.shift() ?? []);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a tagged-template fake standing in for the pool
  return { sql: fn as unknown as Sql, statements };
}

function fakeSpawner(
  overrides: Partial<LightSessionSpawner> = {},
): LightSessionSpawner {
  return {
    create: vi.fn(() =>
      Promise.resolve({
        session: {
          sessionId: 'x',
          organizationId: ORG,
          profile: 'default' as const,
          state: 'ready',
          backend: 'docker',
          createdAtMs: 0,
          expiresAtMs: 0,
          idleTimeoutMs: 0,
        },
      }),
    ),
    isAlive: vi.fn(() => Promise.resolve(true)),
    destroy: vi.fn(() => Promise.resolve(true)),
    destroyIfIdle: vi.fn(() =>
      Promise.resolve({ destroyed: true, busy: false }),
    ),
    ...overrides,
  };
}

const sessionRow = (status: string) => ({
  id: 'row-0',
  organizationId: ORG,
  sessionId: lightSessionId(ORG, 'thread-1'),
  profile: 'default',
  status,
  ownerType: 'light',
  ownerId: 'thread-1',
  createdBy: 'u1',
  agentKind: null,
  llmGatewayKeyId: null,
  pinned: false,
  createdAt: 0,
  expiresAt: 0,
  lastActivityAt: null,
  destroyedAt: null,
});

beforeEach(() => {
  vi.mocked(getSessionBySessionId).mockReset().mockResolvedValue(null);
  vi.mocked(reserveSessionSlot).mockReset().mockResolvedValue('row-1');
  vi.mocked(setSessionStatus).mockClear();
  vi.mocked(markSessionDestroyed).mockClear();
});

describe('lightSessionId', () => {
  it('is stable for one owner, distinct per organization, and a valid session id [SBX-R22]', () => {
    const id = lightSessionId(ORG, 'thread-1');
    expect(id).toBe(lightSessionId(ORG, 'thread-1'));
    expect(id).not.toBe(lightSessionId('org_2', 'thread-1'));
    expect(id).not.toBe(lightSessionId(ORG, 'thread-2'));
    // The spawner's id alphabet, short enough for a container DNS label.
    expect(id).toMatch(/^[a-zA-Z0-9_-]{1,50}$/);
  });
});

describe('acquireLightSession', () => {
  it('reuses the owner’s live sandbox and marks it used [SBX-R22]', async () => {
    vi.mocked(getSessionBySessionId).mockResolvedValue(sessionRow('active'));
    const { sql, statements } = fakeSql();
    const spawner = fakeSpawner();

    const lease = await acquireLightSession(sql, OWNER, spawner);

    expect(lease).toEqual({
      sessionId: lightSessionId(ORG, 'thread-1'),
      created: false,
    });
    expect(spawner.create).not.toHaveBeenCalled();
    expect(reserveSessionSlot).not.toHaveBeenCalled();
    expect(
      statements.some((s) => s.text.includes('SET last_activity_at_ms')),
    ).toBe(true);
  });

  it('starts a hardened default-profile sandbox on the server when none lives', async () => {
    const { sql } = fakeSql();
    const spawner = fakeSpawner();

    const lease = await acquireLightSession(sql, OWNER, spawner);

    expect(lease.created).toBe(true);
    expect(reserveSessionSlot).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        ownerType: 'light',
        ownerId: 'thread-1',
        profile: 'default',
      }),
    );
    expect(spawner.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: lease.sessionId,
        organizationId: ORG,
        profile: 'default',
        placement: 'server',
      }),
    );
    expect(setSessionStatus).toHaveBeenCalledWith(sql, {
      organizationId: ORG,
      sessionId: lease.sessionId,
      status: 'active',
    });
  });

  it('settles a sandbox that vanished and starts a fresh one', async () => {
    vi.mocked(getSessionBySessionId).mockResolvedValue(sessionRow('active'));
    const { sql } = fakeSql();
    const spawner = fakeSpawner({
      isAlive: vi.fn(() => Promise.resolve(false)),
    });

    const lease = await acquireLightSession(sql, OWNER, spawner);

    expect(markSessionDestroyed).toHaveBeenCalledWith(sql, {
      organizationId: ORG,
      sessionId: lease.sessionId,
    });
    expect(lease.created).toBe(true);
  });

  it('takes the slot of the organization’s least recently used idle sandbox when the budget is full [SBX-R23]', async () => {
    vi.mocked(reserveSessionSlot)
      .mockRejectedValueOnce(new SandboxQuotaError('full'))
      .mockResolvedValueOnce('row-2');
    const { sql, statements } = fakeSql([
      [{ sessionId: 'lt-busy' }, { sessionId: 'lt-idle' }],
    ]);
    const destroyIfIdle = vi.fn((sessionId: string) =>
      Promise.resolve(
        sessionId === 'lt-busy'
          ? { destroyed: false, busy: true }
          : { destroyed: true, busy: false },
      ),
    );
    const spawner = fakeSpawner({ destroyIfIdle });

    const lease = await acquireLightSession(sql, OWNER, spawner);

    expect(lease.created).toBe(true);
    expect(destroyIfIdle).toHaveBeenCalledWith('lt-busy');
    expect(markSessionDestroyed).toHaveBeenCalledWith(sql, {
      organizationId: ORG,
      sessionId: 'lt-idle',
    });
    const select = statements.find((s) =>
      s.text.includes('SELECT session_id AS "sessionId"'),
    );
    // Never its own sandbox, never one younger than the grace, oldest use first.
    expect(select?.values).toContain(lease.sessionId);
    expect(select?.text).toContain(
      'ORDER BY coalesce(last_activity_at_ms, created_at_ms) ASC',
    );
  });

  it('answers busy when every light sandbox of the organization is in use [SBX-R23]', async () => {
    vi.mocked(reserveSessionSlot).mockRejectedValue(
      new SandboxQuotaError('full'),
    );
    const { sql } = fakeSql([[{ sessionId: 'lt-busy' }]]);
    const spawner = fakeSpawner({
      destroyIfIdle: vi.fn(() =>
        Promise.resolve({ destroyed: false, busy: true }),
      ),
    });

    await expect(acquireLightSession(sql, OWNER, spawner)).rejects.toThrow(
      LightSandboxBusyError,
    );
    expect(spawner.create).not.toHaveBeenCalled();
  });

  it('settles a create the host refused as busy and says so', async () => {
    const { sql } = fakeSql();
    const spawner = fakeSpawner({
      create: vi.fn(() => Promise.reject(new SpawnerBusyError(5000))),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(acquireLightSession(sql, OWNER, spawner)).rejects.toThrow(
      LightSandboxBusyError,
    );
    expect(setSessionStatus).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ status: 'failed' }),
    );
    expect(spawner.destroy).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  describe('when the host cannot start a sandbox [CHAT-R30]', () => {
    const startFailure = async (
      error: Error,
      spawnerOverrides: Partial<LightSessionSpawner> = {},
    ) => {
      const { sql } = fakeSql();
      const spawner = fakeSpawner({
        create: vi.fn().mockRejectedValue(error),
        ...spawnerOverrides,
      });
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      let thrown: unknown;
      try {
        await acquireLightSession(sql, OWNER, spawner);
      } catch (rejection) {
        thrown = rejection;
      }
      warn.mockRestore();
      return thrown;
    };

    it('reads a host without its runtime image as not ready, not as busy', async () => {
      const thrown = await startFailure(
        new SpawnerBusyError(30_000, undefined, 'runtime_image'),
      );
      expect(thrown).toBeInstanceOf(LightSandboxUnavailableError);
      expect(thrown).toMatchObject({ kind: 'not_ready' });
      expect(setSessionStatus).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'failed' }),
      );
    });

    it('keeps any other host refusal busy, as the host', async () => {
      const thrown = await startFailure(
        new SpawnerBusyError(5_000, undefined, 'host_memory'),
      );
      expect(thrown).toBeInstanceOf(LightSandboxBusyError);
      expect(thrown).toMatchObject({ kind: 'host', retryAfterMs: 5_000 });
    });

    it('says the sandbox service could not be reached', async () => {
      const cause = new SpawnerUnreachableError(
        'POST',
        '/v1/sessions',
        'http://sandbox:8003',
        new Error('connect ECONNREFUSED'),
      );
      const thrown = await startFailure(cause);
      expect(thrown).toBeInstanceOf(LightSandboxUnavailableError);
      expect(thrown).toMatchObject({ kind: 'unreachable', cause });
    });

    it('says the start failed, keeping the spawner error as its cause', async () => {
      const cause = new Error('sandbox session create failed (500): boom');
      const thrown = await startFailure(cause);
      expect(thrown).toBeInstanceOf(LightSandboxUnavailableError);
      expect(thrown).toMatchObject({ kind: 'failed', cause });
      expect((thrown as Error).message).not.toContain('boom');
    });

    it('says the service could not be reached when a running sandbox cannot be checked', async () => {
      vi.mocked(getSessionBySessionId).mockResolvedValueOnce(
        sessionRow('active'),
      );
      const thrown = await startFailure(new Error('never called'), {
        isAlive: vi.fn(() =>
          Promise.reject(
            new SpawnerUnreachableError(
              'POST',
              '/v1/sessions',
              'http://sandbox:8003',
              new Error('connect ECONNREFUSED'),
            ),
          ),
        ),
      });
      expect(thrown).toBeInstanceOf(LightSandboxUnavailableError);
      expect(thrown).toMatchObject({ kind: 'unreachable' });
    });
  });

  it('shares one start between two calls of one round', async () => {
    const { sql } = fakeSql();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const create = vi.fn(async () => {
      await gate;
      return {
        session: {
          sessionId: 'x',
          organizationId: ORG,
          profile: 'default' as const,
          state: 'ready',
          backend: 'docker',
          createdAtMs: 0,
          expiresAtMs: 0,
          idleTimeoutMs: 0,
        },
      };
    });
    const spawner = fakeSpawner({ create });

    const first = acquireLightSession(sql, OWNER, spawner);
    const second = acquireLightSession(sql, OWNER, spawner);
    release();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(create).toHaveBeenCalledOnce();
  });
});

describe('releaseIdleLightSessions', () => {
  it('removes the light sandboxes unused for five minutes, sparing one still running code [SBX-R24]', async () => {
    const now = 1_760_000_000_000;
    const { sql, statements } = fakeSql([
      [
        { sessionId: 'lt-idle', orgId: ORG },
        { sessionId: 'lt-running', orgId: ORG },
      ] as unknown as { sessionId: string }[],
    ]);
    const destroyIfIdle = vi.fn((sessionId: string) =>
      Promise.resolve(
        sessionId === 'lt-running'
          ? { destroyed: false, busy: true }
          : { destroyed: true, busy: false },
      ),
    );

    await expect(
      releaseIdleLightSessions(sql, { now }, { destroyIfIdle }),
    ).resolves.toBe(1);

    expect(LIGHT_SESSION_IDLE_MS).toBe(5 * 60 * 1000);
    const select = statements.find((s) =>
      s.text.includes('SELECT session_id AS "sessionId"'),
    );
    expect(select?.values).toContain(now - LIGHT_SESSION_IDLE_MS);
    expect(markSessionDestroyed).toHaveBeenCalledExactlyOnceWith(sql, {
      organizationId: ORG,
      sessionId: 'lt-idle',
    });
  });

  it('spares a working sandbox whose conversation had an older start fail [SBX-R26]', async () => {
    const { sql, statements } = fakeSql();

    await releaseIdleLightSessions(
      sql,
      { now: 1_760_000_000_000 },
      { destroyIfIdle: vi.fn() },
    );

    const select = statements.find((s) =>
      s.text.includes('SELECT session_id AS "sessionId"'),
    );
    // The stale failed row is a candidate only while no newer incarnation of
    // the same session id is live: the spawner and the settle both act on
    // the id, so reaping the old row would take the sandbox its retry made.
    expect(select?.text).toContain('NOT EXISTS');
    expect(select?.text).toContain('newer.created_at_ms > stale.created_at_ms');
    expect(select?.text).toContain(
      "newer.status IN ('creating', 'active', 'degraded')",
    );
    expect(select?.text).toContain('newer.session_id = stale.session_id');
  });
});

describe('releaseLightSession', () => {
  /** A pool whose one question — is there a live light sandbox row for the
   * owner? — is answered `live`. */
  function poolWith(live: boolean): Sql {
    const fn = (strings: TemplateStringsArray) =>
      Promise.resolve(
        strings.join('?').includes('SELECT id FROM app.sandbox_sessions') &&
          live
          ? [{ id: 'row-0' }]
          : [],
      );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a tagged-template fake standing in for the pool
    return fn as unknown as Sql;
  }

  it('gives a finished owner’s sandbox back at once and settles its row', async () => {
    const sql = poolWith(true);
    const destroyIfIdle = vi.fn(() =>
      Promise.resolve({ destroyed: true, busy: false }),
    );

    await expect(
      releaseLightSession(
        sql,
        { organizationId: ORG, ownerKey: 'run-1' },
        {
          destroyIfIdle,
        },
      ),
    ).resolves.toBe(true);

    expect(destroyIfIdle).toHaveBeenCalledExactlyOnceWith(
      lightSessionId(ORG, 'run-1'),
    );
    expect(markSessionDestroyed).toHaveBeenCalledExactlyOnceWith(sql, {
      organizationId: ORG,
      sessionId: lightSessionId(ORG, 'run-1'),
    });
  });

  it('does not ask the spawner for an owner that never started one', async () => {
    const destroyIfIdle = vi.fn();

    await expect(
      releaseLightSession(
        poolWith(false),
        { organizationId: ORG, ownerKey: 'run-1' },
        { destroyIfIdle },
      ),
    ).resolves.toBe(false);

    expect(destroyIfIdle).not.toHaveBeenCalled();
  });

  it('leaves a sandbox that is still running code to the idle release', async () => {
    const destroyIfIdle = vi.fn(() =>
      Promise.resolve({ destroyed: false, busy: true }),
    );

    await expect(
      releaseLightSession(
        poolWith(true),
        { organizationId: ORG, ownerKey: 'run-1' },
        { destroyIfIdle },
      ),
    ).resolves.toBe(false);

    expect(markSessionDestroyed).not.toHaveBeenCalled();
  });

  it('never fails its caller when the spawner cannot be asked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const destroyIfIdle = vi.fn(() => Promise.reject(new Error('down')));

    await expect(
      releaseLightSession(
        poolWith(true),
        { organizationId: ORG, ownerKey: 'run-1' },
        { destroyIfIdle },
      ),
    ).resolves.toBe(false);

    expect(warn).toHaveBeenCalled();
    expect(markSessionDestroyed).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('destroyLightSession', () => {
  const { sql } = fakeSql();

  it('destroys the owner’s sandbox even while it runs code, and settles its row', async () => {
    const destroy = vi.fn(() => Promise.resolve(true));

    await expect(
      destroyLightSession(
        sql,
        { organizationId: ORG, ownerKey: 'check-1' },
        { destroy },
      ),
    ).resolves.toBe(true);

    expect(destroy).toHaveBeenCalledExactlyOnceWith(
      lightSessionId(ORG, 'check-1'),
    );
    expect(markSessionDestroyed).toHaveBeenCalledExactlyOnceWith(sql, {
      organizationId: ORG,
      sessionId: lightSessionId(ORG, 'check-1'),
    });
  });

  it('settles the row of a sandbox that is already gone', async () => {
    await expect(
      destroyLightSession(
        sql,
        { organizationId: ORG, ownerKey: 'check-1' },
        { destroy: vi.fn(() => Promise.resolve(false)) },
      ),
    ).resolves.toBe(false);

    expect(markSessionDestroyed).toHaveBeenCalledOnce();
  });

  it('never fails its caller, and leaves the row to the watchdog, when the spawner cannot be asked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      destroyLightSession(
        sql,
        { organizationId: ORG, ownerKey: 'check-1' },
        { destroy: vi.fn(() => Promise.reject(new Error('down'))) },
      ),
    ).resolves.toBe(false);

    expect(warn).toHaveBeenCalled();
    expect(markSessionDestroyed).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
