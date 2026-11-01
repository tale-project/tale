// @vitest-environment node

/**
 * The idle sweep's side of the contract: which windows it runs, strictest
 * first, with which cutoffs and how much of the run's cap, the audit row it
 * writes for every session a window revoked, and (#5164) the stamp a
 * five-minute session gets when a window comes into force for it and the
 * clamp under a set `SESSION_IDLE_TIMEOUT_MINUTES`. The statements' own
 * rules — which real rows go or move — are proven against Postgres by the
 * `checkIdleSessionSweep` lane of `backend:integration`
 * (`session-idle.integration.ts`); here a model of the table answers them.
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
import {
  clampSessionsToIdleWindow,
  revokeIdleSessions,
} from './session-idle.ts';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * The lifetimes a refresh writes with the variable unset (#5164): Better
 * Auth's seven days for a session no window covers, refreshed every five
 * minutes, and four minutes less for one a window covers, refreshed every
 * minute.
 */
const FIVE_MINUTE_ROW = 7 * DAY;
const ONE_MINUTE_ROW = 7 * DAY - 4 * MINUTE;

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
  /** Instead of `expiresInMs`: its expiry, as a lifetime from its last
   * refresh. */
  lifetimeMs?: number;
  /** Since when it exists; since its last refresh by default. */
  createdMsAgo?: number;
}

interface Pass {
  organizationIds: string[];
  idleBefore: Date;
  now: Date;
  limit: number;
}

interface ClampPass {
  above: Date;
  from: Date;
  batch: number;
}

function timestamp(value: unknown): number {
  if (!(value instanceof Date)) throw new Error('expected a timestamp');
  return value.getTime();
}

function seconds(value: unknown): number {
  if (typeof value !== 'number') throw new Error('expected seconds');
  return value * 1000;
}

function count(value: unknown): number {
  if (typeof value !== 'number') throw new Error('expected a count');
  return value;
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('expected an id list');
  return value.map(String);
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
  /** The moment the sessions' ages count back from; `NOW` by default. */
  now?: number;
}) {
  const at = seed.now ?? NOW;
  const sessions = seed.sessions.map((session) => {
    const updatedAt = at - session.idleMs;
    return {
      ...session,
      updatedAt,
      expiresAt:
        session.lifetimeMs === undefined
          ? at + (session.expiresInMs ?? DAY)
          : updatedAt + session.lifetimeMs,
      createdAt:
        session.createdMsAgo === undefined
          ? updatedAt
          : at - session.createdMsAgo,
    };
  });
  /** A five-minute row of a window, by its own columns (the SQL's rule). */
  const fiveMinute = (
    session: (typeof sessions)[number],
    since: unknown,
    above: unknown,
    atMost: unknown,
  ) => {
    const lifetime = session.expiresAt - session.updatedAt;
    return (
      session.updatedAt >= timestamp(since) &&
      lifetime > seconds(above) &&
      lifetime <= seconds(atMost)
    );
  };
  const passes: Pass[] = [];
  const stamps: Pass[] = [];
  const clamps: ClampPass[] = [];
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
    if (text.startsWith('WITH "unbounded" AS MATERIALIZED')) {
      const [above, from, oneDayFrom, oneDayTo, batch, now, refresh] = values;
      const expiresIn = values[9];
      clamps.push({
        above: new Date(timestamp(above)),
        from: new Date(timestamp(from)),
        batch: count(batch),
      });
      const taken = sessions
        .filter((session) => {
          const lifetime = session.expiresAt - session.createdAt;
          return (
            session.expiresAt > timestamp(above) &&
            session.expiresAt >= timestamp(from) &&
            !(lifetime >= seconds(oneDayFrom) && lifetime <= seconds(oneDayTo))
          );
        })
        .toSorted((a, b) => a.expiresAt - b.expiresAt)
        .slice(0, count(batch));
      return Promise.resolve(
        taken.map((session) => {
          const expiresAt = new Date(session.expiresAt);
          const stamp = Math.max(
            session.updatedAt,
            Math.min(timestamp(now), session.updatedAt + seconds(refresh)),
          );
          session.updatedAt = stamp;
          session.expiresAt = Math.min(
            session.expiresAt,
            stamp + seconds(expiresIn),
          );
          return { expiresAt };
        }),
      );
    }
    if (text.startsWith('WITH "band" AS MATERIALIZED')) {
      const [since, idleBefore, now, above, atMost, organizationIds, limit] =
        values;
      const [refresh, lifetime] = [values[8], values[11]];
      const orgIds = idList(organizationIds);
      stamps.push({
        organizationIds: orgIds,
        idleBefore: new Date(timestamp(idleBefore)),
        now: new Date(timestamp(now)),
        limit: count(limit),
      });
      const taken = sessions
        .filter(
          (session) =>
            session.updatedAt < timestamp(idleBefore) &&
            session.expiresAt > timestamp(now) &&
            fiveMinute(session, since, above, atMost) &&
            activeIn(session.userId, orgIds).length > 0,
        )
        .toSorted((a, b) => a.updatedAt - b.updatedAt)
        .slice(0, count(limit));
      return Promise.resolve(
        taken.map((session) => {
          const stamp = Math.min(
            timestamp(now),
            session.updatedAt + seconds(refresh),
          );
          session.updatedAt = stamp;
          session.expiresAt = Math.min(
            session.expiresAt,
            stamp + seconds(lifetime),
          );
          return { id: session.id };
        }),
      );
    }
    if (text.startsWith('WITH "idle" AS MATERIALIZED')) {
      const [idleBefore, now, since, above, atMost, organizationIds, limit] =
        values;
      const orgIds = idList(organizationIds);
      passes.push({
        organizationIds: orgIds,
        idleBefore: new Date(timestamp(idleBefore)),
        now: new Date(timestamp(now)),
        limit: count(limit),
      });
      const taken = sessions
        .filter(
          (session) =>
            session.updatedAt < timestamp(idleBefore) &&
            session.expiresAt > timestamp(now) &&
            !fiveMinute(session, since, above, atMost) &&
            activeIn(session.userId, orgIds).length > 0,
        )
        .toSorted((a, b) => a.updatedAt - b.updatedAt)
        .slice(0, count(limit));
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
    stamps,
    clamps,
    statements,
    audits,
    transactions: () => transactions,
    remaining: () => sessions.map((session) => session.id).toSorted(),
    /** A session's two timestamps as they stand. */
    row: (id: string) => {
      const session = sessions.find((candidate) => candidate.id === id);
      if (session === undefined) throw new Error(`no session ${id}`);
      return {
        updatedAt: new Date(session.updatedAt),
        expiresAt: new Date(session.expiresAt),
      };
    },
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
      stamped: 0,
      clamped: 0,
    });
    expect(statements.map((statement) => statement.text)).toEqual([
      'SELECT "id" FROM "organization" ORDER BY "id"',
    ]);
  });

  it("stamps a window's five-minute sessions in one statement first, locked as they are taken", async () => {
    policies.set('o1', 15);
    const { sql, statements } = world({
      orgs: ['o1'],
      members: [{ userId: 'u1', organizationId: 'o1' }],
      sessions: [],
    });
    await revokeIdleSessions(sql, { now: NOW });
    expect(statements[1]).toEqual({
      text:
        'WITH "band" AS MATERIALIZED ( SELECT s."id" FROM "session" s' +
        ' WHERE s."updatedAt" >= ? AND s."updatedAt" < ? AND s."expiresAt" > ?' +
        ' AND s."expiresAt" - s."updatedAt" > make_interval(secs => ?)' +
        ' AND s."expiresAt" - s."updatedAt" <= make_interval(secs => ?)' +
        ' AND EXISTS ( SELECT 1 FROM "member" m WHERE m."userId" = s."userId"' +
        ' AND m."organizationId" = ANY(?) AND lower(m."role") <> \'disabled\' )' +
        ' ORDER BY s."updatedAt" LIMIT ? FOR UPDATE OF s SKIP LOCKED )' +
        ' UPDATE "session" s SET "updatedAt" = least(' +
        ' ?, s."updatedAt" + make_interval(secs => ?) ),' +
        ' "expiresAt" = least( s."expiresAt", least(' +
        ' ?, s."updatedAt" + make_interval(secs => ?) )' +
        ' + make_interval(secs => ?) )' +
        ' FROM "band" b WHERE s."id" = b."id" RETURNING s."id"',
      // Touched within five minutes before the cutoff, refreshed outside
      // every window (seven days ahead, give or take a second): the stamp
      // is five minutes on, and the expiry four minutes short of seven days
      // past it.
      values: [
        new Date(NOW - 20 * MINUTE),
        new Date(NOW - 15 * MINUTE),
        new Date(NOW),
        7 * 24 * 60 * 60 - 4 * 60 + 1,
        7 * 24 * 60 * 60 + 1,
        ['o1'],
        500,
        new Date(NOW),
        300,
        new Date(NOW),
        300,
        7 * 24 * 60 * 60 - 4 * 60,
      ],
    });
  });

  it('deletes and reads back a window in one statement, locked as it is taken', async () => {
    policies.set('o1', 15);
    const { sql, statements } = world({
      orgs: ['o1'],
      members: [{ userId: 'u1', organizationId: 'o1' }],
      sessions: [],
    });
    await revokeIdleSessions(sql, { now: NOW });
    expect(statements[2]).toEqual({
      text:
        'WITH "idle" AS MATERIALIZED ( SELECT s."id" FROM "session" s' +
        ' WHERE s."updatedAt" < ? AND s."expiresAt" > ?' +
        ' AND NOT ( s."updatedAt" >= ?' +
        ' AND s."expiresAt" - s."updatedAt" > make_interval(secs => ?)' +
        ' AND s."expiresAt" - s."updatedAt" <= make_interval(secs => ?) )' +
        ' AND EXISTS ( SELECT 1 FROM "member" m WHERE m."userId" = s."userId"' +
        ' AND m."organizationId" = ANY(?) AND lower(m."role") <> \'disabled\' )' +
        ' ORDER BY s."updatedAt" LIMIT ? FOR UPDATE OF s SKIP LOCKED )' +
        ' DELETE FROM "session" s USING "idle" i WHERE s."id" = i."id"' +
        ' RETURNING s."id", s."userId", ( SELECT min(m."organizationId")' +
        ' FROM "member" m WHERE m."userId" = s."userId"' +
        ' AND m."organizationId" = ANY(?) AND lower(m."role") <> \'disabled\' )' +
        ' AS "organizationId"',
      // A five-minute row the stamp did not reach is judged as if stamped.
      values: [
        new Date(NOW - 15 * MINUTE),
        new Date(NOW),
        new Date(NOW - 20 * MINUTE),
        7 * 24 * 60 * 60 - 4 * 60 + 1,
        7 * 24 * 60 * 60 + 1,
        ['o1'],
        500,
        ['o1'],
      ],
    });
    expect(statements).toHaveLength(3);
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
      stamped: 0,
      clamped: 0,
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
      stamped: 0,
      clamped: 0,
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
    policies.set('o1', 10);
    const { sql, passes, remaining } = lonely(10 * MINUTE + 30_000);
    expect((await revokeIdleSessions(sql, { now: NOW })).revoked).toBe(1);
    expect(passes[0]?.idleBefore).toEqual(new Date(NOW - 10 * MINUTE));
    expect(remaining()).toEqual([]);
  });

  it('allows for the cache: a stamp that may lag by the cache length is not idle yet', async () => {
    policies.set('o1', 10);
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

describe('a window coming into force for a five-minute session (#5164)', () => {
  /** When the windows below come into force: 06:00 UTC. */
  const TURN_ON = Date.parse('2026-10-08T06:00:00Z');

  it('keeps a session used a minute before a window came on, until idle past it', async () => {
    // A 30-minute window comes on at 06:00. The session's last request was
    // at 05:59, and its five-minute refresh fell at 05:54:01 — the earliest
    // that request allows.
    policies.set('o1', 30);
    const { sql, remaining, row } = world({
      now: TURN_ON,
      orgs: ['o1'],
      members: [{ userId: 'u1', organizationId: 'o1' }],
      sessions: [
        {
          id: 's1',
          userId: 'u1',
          idleMs: 5 * MINUTE + 59_000,
          lifetimeMs: FIVE_MINUTE_ROW,
        },
      ],
    });
    for (const minutes of [0, 5, 10, 15, 20]) {
      const sweep = await revokeIdleSessions(sql, {
        now: TURN_ON + minutes * MINUTE,
      });
      expect(sweep).toMatchObject({ revoked: 0, stamped: 0 });
    }
    // 06:25: its refresh, 05:54:01, is older than the cutoff, 05:55, but
    // its last request may not be. It is stamped five minutes on, not
    // revoked...
    expect(
      await revokeIdleSessions(sql, { now: TURN_ON + 25 * MINUTE }),
    ).toEqual({ orgsWithWindow: 1, revoked: 0, stamped: 1, clamped: 0 });
    expect(row('s1')).toEqual({
      updatedAt: new Date(TURN_ON - 59_000),
      expiresAt: new Date(TURN_ON - 5 * MINUTE - 59_000 + FIVE_MINUTE_ROW),
    });
    // ...and goes at 06:30, when its last request is 31 minutes old: as it
    // does today.
    expect(
      await revokeIdleSessions(sql, { now: TURN_ON + 30 * MINUTE }),
    ).toEqual({ orgsWithWindow: 1, revoked: 1, stamped: 0, clamped: 0 });
    expect(remaining()).toEqual([]);
  });

  it('revokes a session last used 31 minutes before a window came on at most five minutes late', async () => {
    // Its last request was at 05:29. Today's sweep revokes it at 06:00.
    policies.set('o1', 30);
    const { sql, remaining, audits } = world({
      now: TURN_ON,
      orgs: ['o1'],
      members: [{ userId: 'u1', organizationId: 'o1' }],
      sessions: [
        // Refreshed at that request: its row cannot tell it from one used
        // until 05:34.
        {
          id: 'refreshed-then',
          userId: 'u1',
          idleMs: 31 * MINUTE,
          lifetimeMs: FIVE_MINUTE_ROW,
        },
        // Refreshed before it, at 05:24:01: a request after 05:29:01 would
        // have refreshed it again.
        {
          id: 'refreshed-before',
          userId: 'u1',
          idleMs: 35 * MINUTE + 59_000,
          lifetimeMs: FIVE_MINUTE_ROW,
        },
      ],
    });
    expect(await revokeIdleSessions(sql, { now: TURN_ON })).toEqual({
      orgsWithWindow: 1,
      revoked: 1,
      stamped: 1,
      clamped: 0,
    });
    expect(remaining()).toEqual(['refreshed-then']);
    expect(
      await revokeIdleSessions(sql, { now: TURN_ON + 5 * MINUTE }),
    ).toEqual({ orgsWithWindow: 1, revoked: 1, stamped: 0, clamped: 0 });
    expect(remaining()).toEqual([]);
    expect(audits).toEqual([
      revocation('refreshed-before', 'u1', 'o1'),
      revocation('refreshed-then', 'u1', 'o1'),
    ]);
  });

  it('under a window shorter than five minutes, holds a stamped session one sweep at most', async () => {
    // A two-minute window: refreshed at 05:57, the session may have served
    // requests until now without a write. The 06:00 sweep stamps it 06:00,
    // and the next revokes it.
    policies.set('o1', 2);
    const { sql, remaining, row } = world({
      now: TURN_ON,
      orgs: ['o1'],
      members: [{ userId: 'u1', organizationId: 'o1' }],
      sessions: [
        {
          id: 's1',
          userId: 'u1',
          idleMs: 3 * MINUTE,
          lifetimeMs: FIVE_MINUTE_ROW,
        },
      ],
    });
    expect(await revokeIdleSessions(sql, { now: TURN_ON })).toMatchObject({
      revoked: 0,
      stamped: 1,
    });
    expect(row('s1').updatedAt).toEqual(new Date(TURN_ON));
    expect(
      await revokeIdleSessions(sql, { now: TURN_ON + 5 * MINUTE }),
    ).toMatchObject({ revoked: 1, stamped: 0 });
    expect(remaining()).toEqual([]);
  });

  it('stamps the sessions of a member who joins a window, or is enabled in one again', async () => {
    policies.set('o1', 30);
    const members: Member[] = [
      { userId: 'returning', organizationId: 'o1', role: 'disabled' },
    ];
    const { sql, remaining, row } = world({
      now: TURN_ON,
      orgs: ['o1'],
      members,
      sessions: [
        {
          id: 'joining',
          userId: 'joining',
          idleMs: 32 * MINUTE,
          lifetimeMs: FIVE_MINUTE_ROW,
        },
        {
          id: 'returning',
          userId: 'returning',
          idleMs: 32 * MINUTE,
          lifetimeMs: FIVE_MINUTE_ROW,
        },
        // Refreshed at 05:20: unused since 05:25 at the latest.
        {
          id: 'joining-idle',
          userId: 'joining',
          idleMs: 40 * MINUTE,
          lifetimeMs: FIVE_MINUTE_ROW,
        },
      ],
    });
    // No window covers either user yet: nothing moves.
    expect(
      await revokeIdleSessions(sql, { now: TURN_ON - 5 * MINUTE }),
    ).toMatchObject({ revoked: 0, stamped: 0 });
    members.push({ userId: 'joining', organizationId: 'o1' });
    members[0] = { userId: 'returning', organizationId: 'o1' };
    expect(await revokeIdleSessions(sql, { now: TURN_ON })).toEqual({
      orgsWithWindow: 1,
      revoked: 1,
      stamped: 2,
      clamped: 0,
    });
    expect(remaining()).toEqual(['joining', 'returning']);
    expect(row('joining').updatedAt).toEqual(new Date(TURN_ON - 27 * MINUTE));
    expect(row('returning').updatedAt).toEqual(new Date(TURN_ON - 27 * MINUTE));
  });

  it('judges a tightened window by the stamp alone: its sessions refresh every minute already', async () => {
    policies.set('o1', 60);
    const { sql, remaining, stamps } = world({
      now: TURN_ON,
      orgs: ['o1'],
      members: [{ userId: 'u1', organizationId: 'o1' }],
      sessions: [
        {
          id: 'idle-31',
          userId: 'u1',
          idleMs: 31 * MINUTE,
          lifetimeMs: ONE_MINUTE_ROW,
        },
        {
          id: 'idle-29',
          userId: 'u1',
          idleMs: 29 * MINUTE,
          lifetimeMs: ONE_MINUTE_ROW,
        },
      ],
    });
    expect(
      await revokeIdleSessions(sql, { now: TURN_ON - 5 * MINUTE }),
    ).toMatchObject({ revoked: 0, stamped: 0 });
    policies.set('o1', 30);
    expect(await revokeIdleSessions(sql, { now: TURN_ON })).toEqual({
      orgsWithWindow: 1,
      revoked: 1,
      stamped: 0,
      clamped: 0,
    });
    expect(remaining()).toEqual(['idle-29']);
    // Each sweep ran the stamp, which found no five-minute row.
    expect(stamps).toHaveLength(2);
  });

  it("judges a five-minute session the stamp's cap leaves as if stamped", async () => {
    policies.set('o1', 30);
    const { sql, remaining } = world({
      now: TURN_ON,
      orgs: ['o1'],
      members: [{ userId: 'u1', organizationId: 'o1' }],
      sessions: Array.from({ length: 501 }, (_, index) => ({
        id: `s-${String(index).padStart(3, '0')}`,
        userId: 'u1',
        idleMs: 34 * MINUTE - index,
        lifetimeMs: FIVE_MINUTE_ROW,
      })),
    });
    expect(await revokeIdleSessions(sql, { now: TURN_ON })).toEqual({
      orgsWithWindow: 1,
      revoked: 0,
      stamped: 500,
      clamped: 0,
    });
    expect(remaining()).toHaveLength(501);
  });

  it('with the variable set, brings earlier sessions under it first and stamps none', async () => {
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '10');
    const { sql, statements, stamps, remaining, row } = world({
      orgs: ['o1'],
      members: [{ userId: 'u1', organizationId: 'o1' }],
      sessions: [
        // Refreshed under the variable two minutes ago: as it was.
        {
          id: 'current',
          userId: 'u1',
          idleMs: 2 * MINUTE,
          lifetimeMs: 10 * MINUTE,
        },
        // Refreshed before it was set, six minutes ago: its last request
        // may be a minute old. Stamped, it stays.
        {
          id: 'earlier-used',
          userId: 'u1',
          idleMs: 6 * MINUTE,
          lifetimeMs: FIVE_MINUTE_ROW,
        },
        // ...half an hour ago: stamped, it has expired, and Better Auth
        // turns it away.
        {
          id: 'earlier-idle',
          userId: 'u1',
          idleMs: 30 * MINUTE,
          lifetimeMs: FIVE_MINUTE_ROW,
        },
      ],
    });
    expect(await revokeIdleSessions(sql, { now: NOW })).toEqual({
      orgsWithWindow: 1,
      revoked: 0,
      stamped: 0,
      clamped: 2,
    });
    expect(
      statements.map((statement) => statement.text.split(' (')[0]),
    ).toEqual([
      'WITH "unbounded" AS MATERIALIZED',
      'SELECT "id" FROM "organization" ORDER BY "id"',
      'WITH "idle" AS MATERIALIZED',
    ]);
    expect(stamps).toEqual([]);
    expect(row('current')).toEqual({
      updatedAt: new Date(NOW - 2 * MINUTE),
      expiresAt: new Date(NOW + 8 * MINUTE),
    });
    expect(row('earlier-used')).toEqual({
      updatedAt: new Date(NOW - MINUTE),
      expiresAt: new Date(NOW + 9 * MINUTE),
    });
    expect(row('earlier-idle')).toEqual({
      updatedAt: new Date(NOW - 25 * MINUTE),
      expiresAt: new Date(NOW - 15 * MINUTE),
    });
    expect(remaining()).toEqual(['current', 'earlier-idle', 'earlier-used']);
  });
});

describe('clampSessionsToIdleWindow (#5164)', () => {
  it('runs no statement while the variable is unset', async () => {
    const { sql, statements } = world({
      orgs: [],
      members: [],
      sessions: [
        { id: 's1', userId: 'u1', idleMs: MINUTE, lifetimeMs: FIVE_MINUTE_ROW },
      ],
    });
    expect(await clampSessionsToIdleWindow(sql, { now: NOW })).toBe(0);
    expect(statements).toEqual([]);
  });

  it('rewrites a batch in one statement, locked as it is taken', async () => {
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '30');
    const { sql, statements } = world({ orgs: [], members: [], sessions: [] });
    expect(await clampSessionsToIdleWindow(sql, { now: NOW })).toBe(0);
    expect(statements).toEqual([
      {
        text:
          'WITH "unbounded" AS MATERIALIZED ( SELECT "id", "expiresAt"' +
          ' FROM "session" WHERE "expiresAt" > ? AND "expiresAt" >= ?' +
          ' AND "expiresAt" - "createdAt" NOT BETWEEN' +
          ' make_interval(secs => ?) AND make_interval(secs => ?)' +
          ' ORDER BY "expiresAt" LIMIT ? FOR UPDATE SKIP LOCKED )' +
          ' UPDATE "session" s SET "updatedAt" = greatest( s."updatedAt",' +
          ' least( ?, s."updatedAt" + make_interval(secs => ?) ) ),' +
          ' "expiresAt" = least( s."expiresAt", greatest( s."updatedAt",' +
          ' least( ?, s."updatedAt" + make_interval(secs => ?) ) )' +
          ' + make_interval(secs => ?) )' +
          ' FROM "unbounded" u WHERE s."id" = u."id" RETURNING u."expiresAt"',
        // Expiring later than the window and a second past now, but not a
        // day from creation.
        values: [
          new Date(NOW + 30 * MINUTE + 1000),
          new Date(NOW + 30 * MINUTE + 1000),
          24 * 60 * 60 - 1,
          24 * 60 * 60 + 1,
          1000,
          new Date(NOW),
          300,
          new Date(NOW),
          300,
          30 * 60,
        ],
      },
    ]);
  });

  it('takes the rows in batches down the expiry, each on from the last', async () => {
    const { sql, clamps, remaining, row } = world({
      orgs: [],
      members: [],
      sessions: [
        { id: 'a', userId: 'u1', idleMs: MINUTE, lifetimeMs: FIVE_MINUTE_ROW },
        {
          id: 'b',
          userId: 'u1',
          idleMs: 2 * MINUTE,
          lifetimeMs: ONE_MINUTE_ROW,
        },
        {
          id: 'c',
          userId: 'u1',
          idleMs: 3 * MINUTE,
          lifetimeMs: FIVE_MINUTE_ROW,
        },
        // Written under a laxer value of the variable.
        {
          id: 'd',
          userId: 'u1',
          idleMs: 4 * MINUTE,
          lifetimeMs: 60 * MINUTE,
        },
        {
          id: 'e',
          userId: 'u1',
          idleMs: 50 * MINUTE,
          lifetimeMs: FIVE_MINUTE_ROW,
        },
        // A "don't remember me" sign-in: a day from its creation, never
        // refreshed. As it was.
        {
          id: 'one-day',
          userId: 'u1',
          idleMs: 2 * 60 * MINUTE,
          lifetimeMs: DAY,
        },
        // Within the window: as it was.
        {
          id: 'within',
          userId: 'u1',
          idleMs: MINUTE,
          lifetimeMs: 30 * MINUTE,
        },
      ],
    });
    expect(
      await clampSessionsToIdleWindow(sql, {
        now: NOW,
        expiresIn: 30 * 60,
        batch: 2,
      }),
    ).toBe(5);
    const above = new Date(NOW + 30 * MINUTE + 1000);
    expect(clamps).toEqual([
      { above, from: above, batch: 2 },
      // 'd', then 'e': the second batch goes on from 'e'.
      { above, from: new Date(NOW - 50 * MINUTE + FIVE_MINUTE_ROW), batch: 2 },
      // 'b' and 'c': the third goes on from 'c', takes 'a' and comes back
      // short.
      { above, from: new Date(NOW - 3 * MINUTE + FIVE_MINUTE_ROW), batch: 2 },
    ]);
    expect(remaining()).toHaveLength(7);
    expect(row('a')).toEqual({
      updatedAt: new Date(NOW),
      expiresAt: new Date(NOW + 30 * MINUTE),
    });
    expect(row('d')).toEqual({
      updatedAt: new Date(NOW),
      expiresAt: new Date(NOW + 30 * MINUTE),
    });
    // Its last request was five minutes after its refresh at the latest.
    expect(row('e')).toEqual({
      updatedAt: new Date(NOW - 45 * MINUTE),
      expiresAt: new Date(NOW - 15 * MINUTE),
    });
    expect(row('one-day')).toEqual({
      updatedAt: new Date(NOW - 2 * 60 * MINUTE),
      expiresAt: new Date(NOW - 2 * 60 * MINUTE + DAY),
    });
    expect(row('within')).toEqual({
      updatedAt: new Date(NOW - MINUTE),
      expiresAt: new Date(NOW + 29 * MINUTE),
    });
  });

  it('never moves back a row refreshed after it started', async () => {
    // Refreshed two minutes after the clamp's now, by a request while it ran
    // or a replica still on the earlier setting.
    const { sql, row } = world({
      orgs: [],
      members: [],
      sessions: [
        {
          id: 'late',
          userId: 'u1',
          idleMs: -2 * MINUTE,
          lifetimeMs: FIVE_MINUTE_ROW,
        },
      ],
    });
    expect(
      await clampSessionsToIdleWindow(sql, { now: NOW, expiresIn: 30 * 60 }),
    ).toBe(1);
    expect(row('late')).toEqual({
      updatedAt: new Date(NOW + 2 * MINUTE),
      expiresAt: new Date(NOW + 32 * MINUTE),
    });
  });
});
