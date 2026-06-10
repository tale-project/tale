import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { mockCreateAuditLog } = vi.hoisted(() => ({
  mockCreateAuditLog: vi.fn(async (..._args: unknown[]) => 'audit_id'),
}));

vi.mock('../audit_logs/helpers', () => ({
  createAuditLog: (...args: unknown[]) => mockCreateAuditLog(...args),
}));

vi.mock('../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth.adapter.findMany',
        deleteOne: 'betterAuth.adapter.deleteOne',
      },
    },
  },
}));

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

const { resolveOrgIdleWindows, shouldRevokeIdleSession, revokeIdleSessions } =
  await import('./session_idle_enforcement');

const MINUTE_MS = 60 * 1000;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shouldRevokeIdleSession (#1502)', () => {
  const now = 1_000_000_000;
  const windowMs = 30 * MINUTE_MS;

  it('revokes a live session idle past the window', () => {
    expect(
      shouldRevokeIdleSession({
        updatedAt: now - windowMs - 1,
        expiresAt: now + MINUTE_MS,
        windowMs,
        now,
      }),
    ).toBe(true);
  });

  it('keeps a session active within the window (boundary inclusive)', () => {
    expect(
      shouldRevokeIdleSession({
        updatedAt: now - windowMs,
        expiresAt: now + MINUTE_MS,
        windowMs,
        now,
      }),
    ).toBe(false);
    expect(
      shouldRevokeIdleSession({
        updatedAt: now - MINUTE_MS,
        expiresAt: now + MINUTE_MS,
        windowMs,
        now,
      }),
    ).toBe(false);
  });

  it('skips already-expired sessions — Better Auth rejects them itself', () => {
    expect(
      shouldRevokeIdleSession({
        updatedAt: now - windowMs - 1,
        expiresAt: now,
        windowMs,
        now,
      }),
    ).toBe(false);
  });
});

describe('resolveOrgIdleWindows (#1502)', () => {
  it('returns the org window as-is when no env backstop is set', () => {
    expect(
      resolveOrgIdleWindows(
        [
          {
            organizationId: 'org1',
            config: { enabled: true, idleTimeoutMinutes: 15 },
          },
        ],
        null,
      ),
    ).toEqual([{ organizationId: 'org1', minutes: 15 }]);
  });

  it('tightens against the env backstop (env is the hard cap)', () => {
    expect(
      resolveOrgIdleWindows(
        [
          {
            organizationId: 'org1',
            config: { enabled: true, idleTimeoutMinutes: 60 },
          },
        ],
        30,
      ),
    ).toEqual([{ organizationId: 'org1', minutes: 30 }]);
  });

  it('skips disabled policies — env enforcement is Better Auth-native', () => {
    expect(
      resolveOrgIdleWindows(
        [
          {
            organizationId: 'org1',
            config: { enabled: false, idleTimeoutMinutes: 5 },
          },
        ],
        30,
      ),
    ).toEqual([]);
  });

  it('warns and skips invalid configs instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      resolveOrgIdleWindows(
        [
          {
            organizationId: 'bad',
            config: { enabled: true, idleTimeoutMinutes: 'NaN' },
          },
          {
            organizationId: 'good',
            config: { enabled: true, idleTimeoutMinutes: 10 },
          },
        ],
        null,
      ),
    ).toEqual([{ organizationId: 'good', minutes: 10 }]);
    expect(warn).toHaveBeenCalledOnce();
  });
});

// ── revokeIdleSessions handler (mocked ctx) ─────────────────────────────────

interface PolicyRow {
  organizationId: string;
  policyType: string;
  config: unknown;
}

interface SessionRow {
  _id: string;
  userId: string;
  updatedAt: number;
  expiresAt: number;
}

function makeCtx(args: {
  policies: PolicyRow[];
  membersByOrg: Record<string, Array<{ userId: string }>>;
  sessionsByUser: Record<string, SessionRow[]>;
}) {
  const deleted: string[] = [];
  const ctx = {
    db: {
      query: (table: string) => {
        expect(table).toBe('governancePolicies');
        return {
          async *[Symbol.asyncIterator]() {
            yield* args.policies;
          },
        };
      },
    },
    runQuery: vi.fn(
      async (ref: unknown, queryArgs: Record<string, unknown>) => {
        expect(ref).toBe('betterAuth.adapter.findMany');
        const where = queryArgs.where;
        if (!Array.isArray(where) || where.length === 0) {
          throw new Error('expected a where clause');
        }
        const clause = where[0];
        if (queryArgs.model === 'member') {
          const page = args.membersByOrg[String(clause.value)] ?? [];
          return { page, isDone: true, continueCursor: '' };
        }
        if (queryArgs.model === 'session') {
          const page = (args.sessionsByUser[String(clause.value)] ?? []).filter(
            (s) => !deleted.includes(s._id),
          );
          return { page, isDone: true, continueCursor: '' };
        }
        throw new Error(`unexpected model ${String(queryArgs.model)}`);
      },
    ),
    runMutation: vi.fn(
      async (ref: unknown, mutationArgs: Record<string, unknown>) => {
        expect(ref).toBe('betterAuth.adapter.deleteOne');
        const input = mutationArgs.input;
        if (
          typeof input !== 'object' ||
          input === null ||
          !('where' in input) ||
          !Array.isArray(input.where)
        ) {
          throw new Error('expected deleteOne input.where');
        }
        deleted.push(String(input.where[0].value));
      },
    ),
  };
  return { ctx, deleted };
}

// The vi.mock above replaces the Convex internalMutation builder with an
// identity function, so the imported value is the raw `{ handler }` config.
const revokeHandler = (
  revokeIdleSessions as unknown as {
    handler: (ctx: unknown) => Promise<{
      orgsWithWindow: number;
      usersChecked: number;
      revoked: number;
    }>;
  }
).handler;

describe('revokeIdleSessions handler (#1502)', () => {
  beforeEach(() => {
    mockCreateAuditLog.mockClear();
    delete process.env.SESSION_IDLE_TIMEOUT_MINUTES;
  });

  it('revokes idle sessions under the strictest org window and writes one audit row per revocation', async () => {
    const now = Date.now();
    const { ctx, deleted } = makeCtx({
      policies: [
        {
          organizationId: 'org30',
          policyType: 'session_idle_timeout',
          config: { enabled: true, idleTimeoutMinutes: 30 },
        },
        {
          organizationId: 'org10',
          policyType: 'session_idle_timeout',
          config: { enabled: true, idleTimeoutMinutes: 10 },
        },
        {
          organizationId: 'orgOff',
          policyType: 'session_idle_timeout',
          config: { enabled: false, idleTimeoutMinutes: 1 },
        },
      ],
      membersByOrg: {
        org30: [{ userId: 'userBoth' }, { userId: 'userLoose' }],
        org10: [{ userId: 'userBoth' }],
        orgOff: [{ userId: 'userUnsubject' }],
      },
      sessionsByUser: {
        // Idle 20 min: inside org30's window but past org10's — the
        // strictest window across the user's orgs decides.
        userBoth: [
          {
            _id: 'sess_both',
            userId: 'userBoth',
            updatedAt: now - 20 * MINUTE_MS,
            expiresAt: now + 60 * MINUTE_MS,
          },
        ],
        userLoose: [
          // Idle 20 min under a 30-min window — stays.
          {
            _id: 'sess_active',
            userId: 'userLoose',
            updatedAt: now - 20 * MINUTE_MS,
            expiresAt: now + 60 * MINUTE_MS,
          },
          // Idle 40 min — revoked.
          {
            _id: 'sess_idle',
            userId: 'userLoose',
            updatedAt: now - 40 * MINUTE_MS,
            expiresAt: now + 60 * MINUTE_MS,
          },
          // Already expired — left for Better Auth to reject.
          {
            _id: 'sess_expired',
            userId: 'userLoose',
            updatedAt: now - 90 * MINUTE_MS,
            expiresAt: now - MINUTE_MS,
          },
        ],
        userUnsubject: [
          {
            _id: 'sess_unsubject',
            userId: 'userUnsubject',
            updatedAt: now - 300 * MINUTE_MS,
            expiresAt: now + 60 * MINUTE_MS,
          },
        ],
      },
    });

    const result = await revokeHandler(ctx);

    expect(result.orgsWithWindow).toBe(2);
    expect(result.revoked).toBe(2);
    expect(deleted.sort()).toEqual(['sess_both', 'sess_idle']);

    expect(mockCreateAuditLog).toHaveBeenCalledTimes(2);
    const calls = mockCreateAuditLog.mock.calls.map(
      ([, row]: unknown[]) => row as Record<string, unknown>,
    );
    const bothRow = calls.find((c) => c.resourceId === 'sess_both');
    expect(bothRow).toMatchObject({
      organizationId: 'org10', // attributed to the org whose window decided
      actorId: 'system',
      actorType: 'system',
      action: 'session.idle_revoked',
      category: 'security',
      resourceType: 'session',
      status: 'success',
    });
    expect(bothRow?.metadata).toMatchObject({
      userId: 'userBoth',
      idleTimeoutMinutes: 10,
    });
  });

  it('does nothing when no org has an enabled policy', async () => {
    const { ctx, deleted } = makeCtx({
      policies: [
        {
          organizationId: 'orgOff',
          policyType: 'session_idle_timeout',
          config: { enabled: false, idleTimeoutMinutes: 5 },
        },
        // Unrelated policy types are filtered before parsing.
        {
          organizationId: 'orgOther',
          policyType: 'retention_policy',
          config: { whatever: true },
        },
      ],
      membersByOrg: {},
      sessionsByUser: {},
    });

    const result = await revokeHandler(ctx);

    expect(result).toEqual({ orgsWithWindow: 0, usersChecked: 0, revoked: 0 });
    expect(deleted).toEqual([]);
    expect(mockCreateAuditLog).not.toHaveBeenCalled();
  });
});
