// @vitest-environment node

/**
 * The idle sweep's side of the contract: which windows it runs, strictest
 * first, with which cutoffs and how much of the run's cap, and the audit row
 * it writes for every session a window revoked. The statement's own rule —
 * which real rows go — is proven against Postgres by the
 * `checkIdleSessionSweep` lane of `backend:integration`
 * (`session-idle.integration.ts`); here a model of the table answers it.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateAuditLogArgs } from '../audit_logs/types.ts';

const policies = vi.hoisted(() => new Map<string, number>());

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn((_sql: unknown, organizationId: string) => {
    const idleTimeoutMinutes = policies.get(organizationId);
    return Promise.resolve(
      idleTimeoutMinutes === undefined
        ? null
        : { enabled: true, idleTimeoutMinutes },
    );
  }),
}));
vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(),
}));

import { createAuditLog } from '../audit_logs/service.ts';
import { revokeIdleSessions } from './session-idle.ts';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface Member {
  userId: string;
  organizationId: string;
  role?: string;
}

interface Session {
  id: string;
  userId: string;
  idleMs: number;
  /** Negative: expired that long ago. */
  expiresInMs?: number;
}

interface Pass {
  organizationIds: string[];
  idleBefore: Date;
  now: Date;
  limit: number;
}

/** A transaction of the fake database: audit rows it wrote, kept only
 * when it commits. */
interface FakeTx {
  audits: CreateAuditLogArgs[];
}

/**
 * The orgs (in id order), their members and sessions, as a table the fake
 * database answers the sweep's statements from — the same rule the SQL
 * states — recording each window's statement and every committed audit row.
 */
function world(seed: {
  orgs: string[];
  members: Member[];
  sessions: Session[];
}) {
  const sessions = seed.sessions.map((session) => ({
    ...session,
    updatedAt: NOW - session.idleMs,
    expiresAt: NOW + (session.expiresInMs ?? DAY),
  }));
  const passes: Pass[] = [];
  const statements: { text: string; values: unknown[] }[] = [];
  const audits: CreateAuditLogArgs[] = [];
  let transactions = 0;
  const activeIn = (userId: string, organizationIds: string[]) =>
    seed.members
      .filter(
        (member) =>
          member.userId === userId &&
          organizationIds.includes(member.organizationId) &&
          (member.role ?? 'member').toLowerCase() !== 'disabled',
      )
      .map((member) => member.organizationId)
      .toSorted();
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text === 'SELECT "id" FROM "organization" ORDER BY "id"') {
      return Promise.resolve(seed.orgs.map((id) => ({ id })));
    }
    if (text.startsWith('WITH "idle" AS MATERIALIZED')) {
      const [idleBefore, now, organizationIds, limit] = values;
      if (
        !(idleBefore instanceof Date) ||
        !(now instanceof Date) ||
        !Array.isArray(organizationIds) ||
        typeof limit !== 'number'
      ) {
        throw new Error('unexpected values for the idle statement');
      }
      const orgIds = organizationIds.map(String);
      passes.push({ organizationIds: orgIds, idleBefore, now, limit });
      const taken = sessions
        .filter(
          (session) =>
            session.updatedAt < idleBefore.getTime() &&
            session.expiresAt > now.getTime() &&
            activeIn(session.userId, orgIds).length > 0,
        )
        .toSorted((a, b) => a.updatedAt - b.updatedAt)
        .slice(0, limit);
      for (const session of taken)
        sessions.splice(sessions.indexOf(session), 1);
      return Promise.resolve(
        taken.map((session) => ({
          id: session.id,
          userId: session.userId,
          organizationId: activeIn(session.userId, orgIds)[0],
        })),
      );
    }
    throw new Error(`unexpected statement: ${text}`);
  };
  const sql = Object.assign(tag, {
    begin: async (run: (tx: FakeTx) => Promise<unknown>) => {
      transactions += 1;
      const tx: FakeTx = { audits: [] };
      const result = await run(tx);
      audits.push(...tx.audits);
      return result;
    },
  });
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call and begin are exercised
    sql: sql as unknown as Sql,
    passes,
    statements,
    audits,
    transactions: () => transactions,
    remaining: () => sessions.map((session) => session.id).toSorted(),
  };
}

/** The audit row the sweep writes for one revoked session. */
function revocation(
  id: string,
  userId: string,
  organizationId: string,
): CreateAuditLogArgs {
  return {
    organizationId,
    actorId: 'system',
    actorType: 'system',
    action: 'session.idle_revoked',
    category: 'security',
    resourceType: 'session',
    resourceId: id,
    status: 'success',
    newState: { userId },
  };
}

beforeEach(() => {
  policies.clear();
  vi.mocked(createAuditLog).mockReset();
  vi.mocked(createAuditLog).mockImplementation((tx, args) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fake database's transaction
    (tx as unknown as FakeTx).audits.push(args);
    return Promise.resolve(`audit-${args.resourceId}`);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('revokeIdleSessions', () => {
  it('runs no statement but the org list when no org has a window', async () => {
    const { sql, statements } = world({
      orgs: ['o1'],
      members: [{ userId: 'u1', organizationId: 'o1' }],
      sessions: [{ id: 's1', userId: 'u1', idleMs: 30 * DAY }],
    });
    expect(await revokeIdleSessions(sql, { now: NOW })).toEqual({
      orgsWithWindow: 0,
      revoked: 0,
    });
    expect(statements.map((statement) => statement.text)).toEqual([
      'SELECT "id" FROM "organization" ORDER BY "id"',
    ]);
  });

  it('deletes and reads back a window in one statement, locked as it is taken', async () => {
    policies.set('o1', 15);
    const { sql, statements } = world({
      orgs: ['o1'],
      members: [{ userId: 'u1', organizationId: 'o1' }],
      sessions: [],
    });
    await revokeIdleSessions(sql, { now: NOW });
    expect(statements[1]).toEqual({
      text:
        'WITH "idle" AS MATERIALIZED ( SELECT s."id" FROM "session" s' +
        ' WHERE s."updatedAt" < ? AND s."expiresAt" > ?' +
        ' AND EXISTS ( SELECT 1 FROM "member" m WHERE m."userId" = s."userId"' +
        ' AND m."organizationId" = ANY(?) AND lower(m."role") <> \'disabled\' )' +
        ' ORDER BY s."updatedAt" LIMIT ? FOR UPDATE OF s SKIP LOCKED )' +
        ' DELETE FROM "session" s USING "idle" i WHERE s."id" = i."id"' +
        ' RETURNING s."id", s."userId", ( SELECT min(m."organizationId")' +
        ' FROM "member" m WHERE m."userId" = s."userId"' +
        ' AND m."organizationId" = ANY(?) AND lower(m."role") <> \'disabled\' )' +
        ' AS "organizationId"',
      values: [new Date(NOW - 15 * MINUTE), new Date(NOW), ['o1'], 500, ['o1']],
    });
    expect(statements).toHaveLength(2);
  });

  it('runs one statement per window, strictest first, its orgs together', async () => {
    policies.set('o1', 30);
    policies.set('o2', 5);
    policies.set('o3', 30);
    const { sql, passes } = world({
      orgs: ['o1', 'o2', 'o3', 'o4'],
      members: [],
      sessions: [],
    });
    expect(await revokeIdleSessions(sql, { now: NOW })).toEqual({
      orgsWithWindow: 3,
      revoked: 0,
    });
    expect(passes).toEqual([
      {
        organizationIds: ['o2'],
        idleBefore: new Date(NOW - 5 * MINUTE),
        now: new Date(NOW),
        limit: 500,
      },
      {
        organizationIds: ['o1', 'o3'],
        idleBefore: new Date(NOW - 30 * MINUTE),
        now: new Date(NOW),
        limit: 500,
      },
    ]);
  });

  it('revokes what the strictest window says, and audits it to that org', async () => {
    // o-strict: 5 min · o-lax: 30 min · o-open: no window.
    policies.set('o-lax', 30);
    policies.set('o-strict', 5);
    policies.set('o-twin', 30);
    const { sql, audits, remaining, transactions } = world({
      orgs: ['o-lax', 'o-open', 'o-strict', 'o-twin'],
      members: [
        { userId: 'both', organizationId: 'o-lax' },
        { userId: 'both', organizationId: 'o-strict' },
        { userId: 'lax', organizationId: 'o-lax' },
        { userId: 'open', organizationId: 'o-open' },
        { userId: 'disabled', organizationId: 'o-strict', role: 'Disabled' },
        { userId: 'disabled', organizationId: 'o-open' },
        { userId: 'twin', organizationId: 'o-twin' },
        { userId: 'twin', organizationId: 'o-lax' },
      ],
      sessions: [
        // Idle past both of its windows: the strict one takes it.
        { id: 'both-45', userId: 'both', idleMs: 45 * MINUTE },
        { id: 'both-20', userId: 'both', idleMs: 20 * MINUTE },
        { id: 'both-fresh', userId: 'both', idleMs: 2 * MINUTE },
        // Expired: Better Auth's expiry and the reaper have it.
        {
          id: 'both-expired',
          userId: 'both',
          idleMs: 60 * MINUTE,
          expiresInMs: -MINUTE,
        },
        { id: 'lax-20', userId: 'lax', idleMs: 20 * MINUTE },
        { id: 'lax-45', userId: 'lax', idleMs: 45 * MINUTE },
        { id: 'open-120', userId: 'open', idleMs: 120 * MINUTE },
        // Disabled where the window is: only the open org counts.
        { id: 'disabled-60', userId: 'disabled', idleMs: 60 * MINUTE },
        // Two orgs share the window: the lowest id owns the audit row.
        { id: 'twin-45', userId: 'twin', idleMs: 45 * MINUTE },
      ],
    });
    expect(await revokeIdleSessions(sql, { now: NOW })).toEqual({
      orgsWithWindow: 3,
      revoked: 4,
    });
    expect(remaining()).toEqual([
      'both-expired',
      'both-fresh',
      'disabled-60',
      'lax-20',
      'open-120',
    ]);
    expect(audits).toEqual([
      revocation('both-45', 'both', 'o-strict'),
      revocation('both-20', 'both', 'o-strict'),
      revocation('lax-45', 'lax', 'o-lax'),
      revocation('twin-45', 'twin', 'o-lax'),
    ]);
    // A window's rows are audited in one transaction.
    expect(transactions()).toBe(2);
  });

  it('shares one cap across the windows, oldest first within each', async () => {
    policies.set('o1', 5);
    policies.set('o2', 30);
    policies.set('o3', 60);
    const strict = Array.from({ length: 498 }, (_, index) => ({
      id: `strict-${String(index).padStart(3, '0')}`,
      userId: 'u1',
      idleMs: 10 * MINUTE + index * 1000,
    }));
    const lax = Array.from({ length: 4 }, (_, index) => ({
      id: `lax-${index}`,
      userId: 'u2',
      idleMs: 40 * MINUTE + index * MINUTE,
    }));
    const { sql, passes, remaining } = world({
      orgs: ['o1', 'o2', 'o3'],
      members: [
        { userId: 'u1', organizationId: 'o1' },
        { userId: 'u2', organizationId: 'o2' },
        { userId: 'u3', organizationId: 'o3' },
      ],
      sessions: [
        ...strict,
        ...lax,
        { id: 'loose', userId: 'u3', idleMs: 2 * 60 * MINUTE },
      ],
    });
    expect((await revokeIdleSessions(sql, { now: NOW })).revoked).toBe(500);
    // The third window is not reached: the cap is spent.
    expect(passes.map((pass) => pass.limit)).toEqual([500, 2]);
    // Of the lax window's four, the two idle longest went.
    expect(remaining()).toEqual(['lax-0', 'lax-1', 'loose']);
  });

  it('writes a failed batch row by row: one bad row keeps the others', async () => {
    policies.set('o1', 15);
    const { sql, audits, remaining } = world({
      orgs: ['o1'],
      members: [{ userId: 'u1', organizationId: 'o1' }],
      sessions: [
        { id: 's1', userId: 'u1', idleMs: 20 * MINUTE },
        { id: 's2', userId: 'u1', idleMs: 30 * MINUTE },
        { id: 's3', userId: 'u1', idleMs: 40 * MINUTE },
      ],
    });
    const refused = new Error('audit row refused');
    vi.mocked(createAuditLog).mockImplementation((tx, args) => {
      if (args.resourceId === 's2') return Promise.reject(refused);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fake database's transaction
      (tx as unknown as FakeTx).audits.push(args);
      return Promise.resolve(`audit-${args.resourceId}`);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await revokeIdleSessions(sql, { now: NOW })).revoked).toBe(3);
    // The revocation stands whatever happened to its evidence.
    expect(remaining()).toEqual([]);
    expect(audits).toEqual([
      revocation('s3', 'u1', 'o1'),
      revocation('s1', 'u1', 'o1'),
    ]);
    expect(warn).toHaveBeenCalledWith(
      '[session-idle] audit batch failed, writing it row by row:',
      refused,
    );
    expect(warn).toHaveBeenCalledWith(
      '[session-idle] audit write failed:',
      refused,
    );
  });
});

describe('idle revocation beside the session cookie cache', () => {
  /** One org, one member, one session last touched `idleMs` ago. */
  const lonely = (idleMs: number) =>
    world({
      orgs: ['o1'],
      members: [{ userId: 'u1', organizationId: 'o1' }],
      sessions: [{ id: 's1', userId: 'u1', idleMs }],
    });

  it('revokes a session idle past its window when the cache is off', async () => {
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '10');
    const { sql, passes, remaining } = lonely(10 * MINUTE + 30_000);
    expect((await revokeIdleSessions(sql, { now: NOW })).revoked).toBe(1);
    expect(passes[0]?.idleBefore).toEqual(new Date(NOW - 10 * MINUTE));
    expect(remaining()).toEqual([]);
  });

  it('allows for the cache: a stamp that may lag by the cache length is not idle yet', async () => {
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '10');
    vi.stubEnv('SESSION_COOKIE_CACHE_SECONDS', '60');
    const lagging = lonely(10 * MINUTE + 30_000);
    expect((await revokeIdleSessions(lagging.sql, { now: NOW })).revoked).toBe(
      0,
    );
    expect(lagging.passes[0]?.idleBefore).toEqual(new Date(NOW - 11 * MINUTE));
    const idle = lonely(10 * MINUTE + 90_000);
    expect((await revokeIdleSessions(idle.sql, { now: NOW })).revoked).toBe(1);
  });
});
