/**
 * SQL-mode identities: users, credential accounts, minted sessions, then —
 * once the organizations exist — memberships and each user's active
 * organization, written straight to Better Auth's tables.
 *
 * Why SQL: a sign-up is a scrypt hash (~80 ms of CPU) plus a handful of
 * writes, so a million users through the API is ~20 CPU-hours. Here the
 * password is hashed ONCE and the rows go in as multi-row
 * `INSERT … ON CONFLICT DO NOTHING` batches, a few in parallel, so a rerun
 * (or a resume) rewrites nothing and a million users take minutes.
 *
 * The rows match what the platform itself writes (see `population.ts`), and
 * every id is deterministic, which is what makes the conflict clause a
 * correct idempotency key: the `member` table has no unique key on
 * (organization, user), so only a stable member id keeps a rerun from
 * doubling memberships.
 */

import { hashPassword, verifyPassword } from 'better-auth/crypto';
import type { Sql } from 'postgres';

import { sessionId, userId } from '../plan.ts';
import { createProgress, mapLimit } from './concurrency.ts';
import { countByIdPrefix } from './db.ts';
import {
  accountId,
  activeOrganizationIndex,
  batches,
  buildAccountRows,
  buildMemberRows,
  buildSessionRows,
  buildUserRows,
  expectedMembershipCount,
  type PopulationPlan,
} from './population.ts';

export interface SqlSeedContext {
  sql: Sql;
  plan: PopulationPlan;
  batchSize: number;
  parallelism: number;
  log: (line: string) => void;
}

export interface IdentityResult {
  usersInserted: number;
  accountsInserted: number;
  sessionsInserted: number;
  /** Tables already complete for this run id, left untouched. */
  skipped: string[];
  elapsedMs: number;
}

const USER_COLUMNS = [
  'id',
  'name',
  'email',
  'emailVerified',
  'createdAt',
  'updatedAt',
  'twoFactorEnabled',
] as const;
const ACCOUNT_COLUMNS = [
  'id',
  'accountId',
  'providerId',
  'userId',
  'password',
  'createdAt',
  'updatedAt',
] as const;
const SESSION_COLUMNS = [
  'id',
  'token',
  'userId',
  'expiresAt',
  'createdAt',
  'updatedAt',
  'ipAddress',
  'userAgent',
] as const;
const MEMBER_COLUMNS = [
  'id',
  'organizationId',
  'userId',
  'role',
  'createdAt',
] as const;

/** Id prefixes of this run's rows, for the completeness counts. */
function prefixes(runId: string) {
  return {
    user: `load_${runId}_u`,
    account: `load_${runId}_a`,
    session: `load_${runId}_s`,
    member: `load_${runId}_m`,
  };
}

/**
 * The scrypt hash every account row carries. When this run already has
 * accounts, their hash is checked against `password` first: a rerun with a
 * different password would insert nothing (the rows exist) and leave a plan
 * whose password signs nobody in.
 */
async function passwordHashFor(
  ctx: SqlSeedContext,
  password: string,
): Promise<string> {
  const existing = await ctx.sql<{ password: string | null }[]>`
    SELECT "password" FROM "account"
    WHERE "id" = ${accountId(ctx.plan.runId, 0)} LIMIT 1
  `;
  const stored = existing[0]?.password;
  if (stored) {
    if (!(await verifyPassword({ hash: stored, password }))) {
      throw new Error(
        `Users of run ${ctx.plan.runId} already exist with a different password; pass the original password or --resume the original plan`,
      );
    }
    return stored;
  }
  return hashPassword(password);
}

/**
 * Users, credential accounts and (with `authSecret`) one session per user.
 * A table whose row count for this run is already complete is skipped
 * outright, so resuming a million-user seed costs three counts.
 */
export async function seedIdentities(
  ctx: SqlSeedContext,
  password: string,
  authSecret: string | null,
): Promise<IdentityResult> {
  const started = performance.now();
  const { sql, plan } = ctx;
  const total = plan.users.count;
  const ids = prefixes(plan.runId);
  const [users, accounts, sessions] = await Promise.all([
    countByIdPrefix(sql, 'user', ids.user),
    countByIdPrefix(sql, 'account', ids.account),
    authSecret === null
      ? Promise.resolve(total)
      : countByIdPrefix(sql, 'session', ids.session),
  ]);
  const doUsers = users < total;
  const doAccounts = accounts < total;
  const doSessions = authSecret !== null && sessions < total;
  const skipped = [
    ...(doUsers ? [] : ['user']),
    ...(doAccounts ? [] : ['account']),
    ...(authSecret !== null && !doSessions ? ['session'] : []),
  ];
  const hash = await passwordHashFor(ctx, password);
  const result: IdentityResult = {
    usersInserted: 0,
    accountsInserted: 0,
    sessionsInserted: 0,
    skipped,
    elapsedMs: 0,
  };
  if (!doUsers && !doAccounts && !doSessions) {
    ctx.log(`[seed] identities already complete for run ${plan.runId}`);
    result.elapsedMs = performance.now() - started;
    return result;
  }
  const progress = createProgress('identities', total, { write: ctx.log });
  const now = new Date();
  await mapLimit(
    batches(total, ctx.batchSize),
    ctx.parallelism,
    async (range) => {
      // Account and session rows reference the user row, so a batch writes
      // its users first; batches themselves are independent.
      if (doUsers) {
        const rows = buildUserRows(plan, range.start, range.end, now);
        const res = await sql`
        INSERT INTO "user" ${sql(rows, ...USER_COLUMNS)}
        ON CONFLICT DO NOTHING
      `;
        result.usersInserted += res.count;
      }
      if (doAccounts) {
        const rows = buildAccountRows(plan, range.start, range.end, hash, now);
        const res = await sql`
        INSERT INTO "account" ${sql(rows, ...ACCOUNT_COLUMNS)}
        ON CONFLICT DO NOTHING
      `;
        result.accountsInserted += res.count;
      }
      if (doSessions && authSecret !== null) {
        const rows = buildSessionRows(
          plan,
          range.start,
          range.end,
          authSecret,
          now,
        );
        const res = await sql`
        INSERT INTO "session" ${sql(rows, ...SESSION_COLUMNS)}
        ON CONFLICT DO NOTHING
      `;
        result.sessionsInserted += res.count;
      }
      progress.tick(range.end - range.start);
    },
  );
  progress.done();
  result.elapsedMs = performance.now() - started;
  return result;
}

export interface MembershipResult {
  inserted: number;
  /** Memberships of organizations that failed to be created. */
  skipped: number;
  alreadyComplete: boolean;
  elapsedMs: number;
}

/**
 * Every non-owner membership (block members with weighted roles, then the
 * mega organization's), for the organizations in `orgIds`.
 */
export async function seedMemberships(
  ctx: SqlSeedContext,
  orgIds: ReadonlyMap<number, string>,
): Promise<MembershipResult> {
  const started = performance.now();
  const { sql, plan } = ctx;
  const expected = expectedMembershipCount(plan);
  const existing = await countByIdPrefix(
    sql,
    'member',
    prefixes(plan.runId).member,
  );
  if (existing >= expected) {
    ctx.log(`[seed] memberships already complete (${existing})`);
    return {
      inserted: 0,
      skipped: 0,
      alreadyComplete: true,
      elapsedMs: performance.now() - started,
    };
  }
  const progress = createProgress('memberships (users)', plan.users.count, {
    write: ctx.log,
  });
  const now = new Date();
  let inserted = 0;
  let skipped = 0;
  await mapLimit(
    batches(plan.users.count, ctx.batchSize),
    ctx.parallelism,
    async (range) => {
      const built = buildMemberRows(plan, range.start, range.end, orgIds, now);
      skipped += built.skipped;
      if (built.rows.length > 0) {
        const res = await sql`
          INSERT INTO "member" ${sql(built.rows, ...MEMBER_COLUMNS)}
          ON CONFLICT DO NOTHING
        `;
        inserted += res.count;
      }
      progress.tick(range.end - range.start);
    },
  );
  progress.done();
  return {
    inserted,
    skipped,
    alreadyComplete: false,
    elapsedMs: performance.now() - started,
  };
}

/**
 * Point each user at the organization they work in: the block organization
 * (else the mega one). Sets `"user"."lastActiveOrganizationId"` — what a
 * fresh sign-in restores — and, for minted sessions, the session's
 * `activeOrganizationId`. Rows already pointing there are not rewritten.
 */
export async function setActiveOrganizations(
  ctx: SqlSeedContext,
  orgIds: ReadonlyMap<number, string>,
  sessionsMinted: boolean,
): Promise<{ users: number; sessions: number; elapsedMs: number }> {
  const started = performance.now();
  const { sql, plan } = ctx;
  const progress = createProgress('active organizations', plan.users.count, {
    write: ctx.log,
  });
  let users = 0;
  let sessions = 0;
  await mapLimit(
    batches(plan.users.count, ctx.batchSize),
    ctx.parallelism,
    async (range) => {
      const userPairs: [string, string][] = [];
      const sessionPairs: [string, string][] = [];
      for (let index = range.start; index < range.end; index += 1) {
        const orgIndex = activeOrganizationIndex(plan, index);
        const orgId = orgIndex === null ? undefined : orgIds.get(orgIndex);
        if (orgId === undefined) continue;
        userPairs.push([userId(plan.runId, index), orgId]);
        sessionPairs.push([sessionId(plan.runId, index), orgId]);
      }
      if (userPairs.length > 0) {
        const res = await sql`
          UPDATE "user" AS u SET "lastActiveOrganizationId" = v.org
          FROM (VALUES ${sql(userPairs)}) AS v (id, org)
          WHERE u."id" = v.id
            AND u."lastActiveOrganizationId" IS DISTINCT FROM v.org
        `;
        users += res.count;
      }
      if (sessionsMinted && sessionPairs.length > 0) {
        const res = await sql`
          UPDATE "session" AS s SET "activeOrganizationId" = v.org
          FROM (VALUES ${sql(sessionPairs)}) AS v (id, org)
          WHERE s."id" = v.id
            AND s."activeOrganizationId" IS DISTINCT FROM v.org
        `;
        sessions += res.count;
      }
      progress.tick(range.end - range.start);
    },
  );
  progress.done();
  return { users, sessions, elapsedMs: performance.now() - started };
}
