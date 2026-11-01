/**
 * Real-Postgres proof of the idle-session sweep (`session-idle.ts`). Across
 * organizations with and without a window, a live session idle past the
 * strictest window its user has goes; a fresh one, one idle inside its
 * window, an expired one, a disabled member's and one whose user has no
 * window stay. Each revocation is audited once, to the organization whose
 * window decided it (of two sharing that window, the lower id), a window's
 * rows in one transaction. A window's statements walk
 * `session_updatedAt_expiresAt_idx` (`db/boot-indexes.ts`) in order.
 *
 * #5164: when a window comes into force for a session refreshed every five
 * minutes, the sweep stamps it before it judges it, and a set
 * `SESSION_IDLE_TIMEOUT_MINUTES` brings earlier rows under its window down
 * `session_expiresAt_idx`. The lane runs with the variable unset.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { sessionRefreshShape } from '@tale/shared/utils/session-idle';
import type { Sql, TransactionSql } from 'postgres';

import { sessionCookieCacheSeconds } from '../../auth/session-cache.ts';
import {
  errorText,
  type RecordCheck,
  withCleanup,
} from '../../integration-lane-helpers.ts';
import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import {
  clampSessionsToIdleWindow,
  fiveMinuteRows,
  idleSessionRevocation,
  idleWindowStamp,
  revokeIdleSessions,
  sessionClampBatch,
} from './session-idle.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export async function checkIdleSessionSweep(
  sql: Sql,
  record: RecordCheck,
): Promise<void> {
  const parts: ReadonlyArray<readonly [string, () => Promise<void>]> = [
    ['the plan of a window', () => checkWindowPlan(sql, record)],
    ['the sweep across organizations', () => checkAcrossOrgs(sql, record)],
    [
      'a window coming into force',
      () => checkWindowComingIntoForce(sql, record),
    ],
  ];
  // Each part records its own failure, so a part that throws fails its
  // check without cutting off the part and lanes after it.
  for (const [part, run] of parts) {
    try {
      await run();
    } catch (error) {
      record(`idle sessions: ${part} runs`, false, errorText(error));
    }
  }
}

/** The plan of `explain`'s statement, sequential scans and sorts ruled out. */
async function planOf(
  sql: Sql,
  explain: (tx: TransactionSql) => Promise<{ 'QUERY PLAN': string }[]>,
): Promise<string> {
  const plan = await sql.begin(async (tx) => {
    await tx`SET LOCAL enable_seqscan = off`;
    await tx`SET LOCAL enable_sort = off`;
    return explain(tx);
  });
  return plan.map((row) => row['QUERY PLAN']).join('\n');
}

/**
 * A window's statements take the least recently used sessions first, and a
 * clamp batch the earliest expiring. On the harness's handful of rows the
 * planner may prefer any index plus a sort, so sorting is ruled out as well:
 * each plan must take its order from an index, and only
 * `session_updatedAt_expiresAt_idx` gives the first, only
 * `session_expiresAt_idx` the second.
 */
async function checkWindowPlan(sql: Sql, record: RecordCheck): Promise<void> {
  const now = Date.now();
  const shape = sessionRefreshShape();
  const idleBefore = new Date(now - 15 * MINUTE);
  const pass = {
    organizationIds: [randomUUID()],
    idleBefore,
    now: new Date(now),
    limit: 500,
    fiveMinute: fiveMinuteRows(shape, idleBefore),
  };
  const revocation = await planOf(
    sql,
    (tx) => tx`EXPLAIN ${idleSessionRevocation(tx, pass)}`,
  );
  record(
    'idle sessions: a window walks session_updatedAt_expiresAt_idx in order, unsorted',
    revocation.includes('session_updatedAt_expiresAt_idx') &&
      !revocation.includes('Sort'),
    revocation,
  );
  const stamp = await planOf(
    sql,
    (tx) => tx`EXPLAIN ${idleWindowStamp(tx, { ...pass, shape })}`,
  );
  record(
    "idle sessions: a window's stamp walks session_updatedAt_expiresAt_idx in order, unsorted",
    stamp.includes('session_updatedAt_expiresAt_idx') &&
      !stamp.includes('Sort'),
    stamp,
  );
  const above = new Date(now + 30 * MINUTE + 1000);
  const clamp = await planOf(
    sql,
    (tx) =>
      tx`EXPLAIN ${sessionClampBatch(tx, {
        now: new Date(now),
        expiresIn: 30 * 60,
        above,
        from: above,
        batch: 1000,
      })}`,
  );
  record(
    'idle sessions: a clamp batch walks session_expiresAt_idx in order, unsorted',
    clamp.includes('session_expiresAt_idx') && !clamp.includes('Sort'),
    clamp,
  );
}

interface FixtureSession {
  /** The end of its id, saying what the sweep must do with it. */
  name: string;
  userId: string;
  idleMinutes: number;
  expired?: boolean;
  /** The organization its audit row names; absent for a session that
   * stays. */
  revokedFor?: string;
}

async function checkAcrossOrgs(sql: Sql, record: RecordCheck): Promise<void> {
  const now = Date.now();
  const prefix = `idle-sweep-${randomUUID().slice(0, 8)}`;
  // The digit orders the ids: of the two organizations sharing the
  // strictest window, `1-strict` has the lower id. Each id is its slug too.
  const org = {
    strict: `${prefix}-1-strict`,
    twin: `${prefix}-2-strict`,
    lax: `${prefix}-3-lax`,
    open: `${prefix}-4-open`,
  };
  const windows: ReadonlyArray<readonly [string, number]> = [
    [org.strict, 5],
    [org.twin, 5],
    [org.lax, 30],
  ];
  const user = {
    both: `${prefix}-both`,
    lax: `${prefix}-lax`,
    twins: `${prefix}-twins`,
    open: `${prefix}-open`,
    disabled: `${prefix}-disabled`,
  };
  // The twins' membership of `2-strict` comes first: the lower id decides,
  // whichever membership the database returns first.
  const memberships: ReadonlyArray<
    readonly [userId: string, orgId: string, role: string]
  > = [
    [user.both, org.strict, 'member'],
    [user.both, org.lax, 'member'],
    [user.lax, org.lax, 'member'],
    [user.twins, org.twin, 'member'],
    [user.twins, org.strict, 'member'],
    [user.open, org.open, 'member'],
    [user.disabled, org.strict, 'disabled'],
    [user.disabled, org.open, 'member'],
  ];
  // Wide of every window by more than the cookie cache's longest lag
  // (5 minutes), so a cache the run configures changes no outcome.
  const sessions: FixtureSession[] = [
    // Idle past the strict window and inside the lax one: the strictest of
    // its user's windows decides, and names its organization.
    {
      name: 'both-idle',
      userId: user.both,
      idleMinutes: 20,
      revokedFor: org.strict,
    },
    { name: 'both-fresh', userId: user.both, idleMinutes: 1 },
    // Idle past every window, but expired: Better Auth's expiry and the
    // reaper have it.
    { name: 'both-expired', userId: user.both, idleMinutes: 60, expired: true },
    { name: 'lax-inside', userId: user.lax, idleMinutes: 20 },
    {
      name: 'lax-idle',
      userId: user.lax,
      idleMinutes: 45,
      revokedFor: org.lax,
    },
    {
      name: 'twins-idle',
      userId: user.twins,
      idleMinutes: 20,
      revokedFor: org.strict,
    },
    // An organization without a window revokes nothing.
    { name: 'open-idle', userId: user.open, idleMinutes: 120 },
    // A disabled membership gives its window to nobody.
    { name: 'disabled-idle', userId: user.disabled, idleMinutes: 60 },
  ];
  const sessionId = (session: FixtureSession): string =>
    `${prefix}-${session.name}`;
  const orgIds = Object.values(org);
  const userIds = Object.values(user);
  const configRoot = process.env.TALE_CONFIG_DIR ?? '';

  await withCleanup(
    [
      [
        'deletes its sessions',
        () => sql`DELETE FROM "session" WHERE "userId" = ANY(${userIds})`,
      ],
      [
        'deletes its memberships',
        () => sql`DELETE FROM "member" WHERE "userId" = ANY(${userIds})`,
      ],
      [
        'deletes its organizations',
        () => sql`DELETE FROM "organization" WHERE "id" = ANY(${orgIds})`,
      ],
      [
        'deletes its users',
        () => sql`DELETE FROM "user" WHERE "id" = ANY(${userIds})`,
      ],
      [
        'removes its policy files',
        async () => {
          for (const id of orgIds) {
            await rm(path.join(configRoot, id), {
              recursive: true,
              force: true,
            });
          }
        },
      ],
    ],
    async () => {
      // The policies are on disk before their organizations exist, so no
      // read caches an organization without its window.
      for (const [id, minutes] of windows) {
        const dir = path.join(configRoot, id, 'governance');
        await mkdir(dir, { recursive: true });
        await writeFile(
          path.join(dir, 'session-idle-timeout.yml'),
          ['enabled: true', `idleTimeoutMinutes: ${minutes}`].join('\n'),
        );
      }
      clearOrgConfigCaches();
      const stamp = new Date(now);
      await sql`
        INSERT INTO "organization" ${sql(
          orgIds.map((id) => ({
            id,
            name: 'Idle sweep fixture',
            slug: id,
            createdAt: stamp,
          })),
        )}
      `;
      await sql`
        INSERT INTO "user" ${sql(
          userIds.map((id) => ({
            id,
            email: `${id}@example.test`,
            name: 'Idle sweep fixture',
            emailVerified: true,
            createdAt: stamp,
            updatedAt: stamp,
          })),
        )}
      `;
      await sql`
        INSERT INTO "member" ${sql(
          memberships.map(([userId, organizationId, role], index) => ({
            id: `${prefix}-member-${index}`,
            organizationId,
            userId,
            role,
            createdAt: new Date(now + index),
          })),
        )}
      `;
      // One statement: every session is there, or none is.
      await sql`
        INSERT INTO "session" ${sql(
          sessions.map((session) => ({
            id: sessionId(session),
            userId: session.userId,
            token: `tok-${sessionId(session)}`,
            createdAt: new Date(now - DAY),
            updatedAt: new Date(now - session.idleMinutes * MINUTE),
            expiresAt: new Date(
              session.expired === true ? now - MINUTE : now + DAY,
            ),
          })),
        )}
      `;

      const sweep = await revokeIdleSessions(sql);
      const ids = sessions.map(sessionId);
      const kept = new Set(
        (
          await sql<{ id: string }[]>`
            SELECT "id" FROM "session" WHERE "id" = ANY(${ids})
          `
        ).map((row) => row.id),
      );
      const wrong = sessions
        .filter(
          (session) =>
            kept.has(sessionId(session)) === (session.revokedFor !== undefined),
        )
        .map((session) => session.name);
      record(
        "idle sessions: the strictest of a user's windows revokes, nothing else does",
        sweep.orgsWithWindow >= windows.length && wrong.length === 0,
        `windows=${sweep.orgsWithWindow} (want >= ${windows.length}), revoked=${sweep.revoked}, wrong=${wrong.join(',') || 'none'}`,
      );

      const audits = await sql<
        { sessionId: string; row: string; writerXid: string }[]
      >`
        SELECT resource_id AS "sessionId",
               concat_ws(' ', resource_id, org_id, actor_type, actor_id,
                         category, resource_type, status,
                         new_state->>'userId') AS row,
               writer_xid::text AS "writerXid"
        FROM app.audit_logs
        WHERE action = 'session.idle_revoked' AND resource_id = ANY(${ids})
      `;
      const want = sessions
        .flatMap((session) =>
          session.revokedFor === undefined
            ? []
            : [
                [
                  sessionId(session),
                  session.revokedFor,
                  'system',
                  'system',
                  'security',
                  'session',
                  'success',
                  session.userId,
                ].join(' '),
              ],
        )
        .toSorted();
      const got = audits.map((audit) => audit.row).toSorted();
      record(
        'idle sessions: one audit row per revocation, naming the organization whose window decided it',
        JSON.stringify(got) === JSON.stringify(want),
        `got=${JSON.stringify(got)}, want=${JSON.stringify(want)}`,
      );

      const writer = new Map(
        audits.map((audit) => [audit.sessionId, audit.writerXid]),
      );
      const strictWriter = writer.get(`${prefix}-both-idle`);
      const laxWriter = writer.get(`${prefix}-lax-idle`);
      record(
        "idle sessions: a window's audit rows are written in one transaction",
        strictWriter !== undefined &&
          writer.get(`${prefix}-twins-idle`) === strictWriter &&
          laxWriter !== undefined &&
          laxWriter !== strictWriter,
        `writers=${JSON.stringify(Object.fromEntries(writer))} (want both-idle and twins-idle in one, lax-idle in another)`,
      );
    },
  );
}

/**
 * A session of {@link checkWindowComingIntoForce}: how its row was written,
 * and its `"updatedAt"` in minutes after the window's cutoff — as written,
 * after the first sweep, and after the second, the fixture's rows having
 * moved five minutes back in between — or `null` once revoked.
 */
interface IncomingSession {
  name: string;
  userId: string;
  kind: 'five-minute' | 'one-minute' | 'one-day' | 'within';
  usedAt: number;
  afterFirst: number | null;
  afterSecond: number | null;
}

interface SessionTimes {
  updatedAt: number;
  expiresAt: number;
}

/**
 * #5164: an organization's 30-minute window comes into force over sessions
 * Better Auth refreshes every five minutes, written outside every window
 * (the lane runs with `SESSION_IDLE_TIMEOUT_MINUTES` unset); such a row may
 * have served requests up to five minutes past its `"updatedAt"`. The first
 * sweep stamps each one the window would revoke though it may have been
 * used since the cutoff, and revokes the idle ones. Five minutes on, with no
 * request in between, the second revokes what the stamp kept: a sweep later
 * than a row refreshed every minute would have gone. The five minutes pass
 * by moving the fixture's own rows back, not by sweeping later, so that no
 * other session in the database is judged early.
 *
 * Before the sweeps, in a transaction that rolls back, the clamp a set
 * variable runs brings every longer-lived row under a 30-minute window with
 * the same stamp, and leaves a "don't remember me" row and one inside the
 * window as they are.
 */
async function checkWindowComingIntoForce(
  sql: Sql,
  record: RecordCheck,
): Promise<void> {
  const now = Date.now();
  const prefix = `idle-stamp-${randomUUID().slice(0, 8)}`;
  const org = { on: `${prefix}-org-on`, open: `${prefix}-org-open` };
  const user = {
    on: `${prefix}-user-on`,
    open: `${prefix}-user-open`,
    disabled: `${prefix}-user-disabled`,
  };
  const memberships: ReadonlyArray<
    readonly [userId: string, orgId: string, role: string]
  > = [
    [user.on, org.on, 'member'],
    [user.open, org.open, 'member'],
    [user.disabled, org.on, 'disabled'],
  ];
  const windowMinutes = 30;
  const { expiresIn, advance } = sessionRefreshShape();
  const cutoff =
    now - windowMinutes * MINUTE - sessionCookieCacheSeconds() * 1000;
  // `"expiresAt"` less `"updatedAt"`, as each kind of row is written.
  const lifetime: Record<IncomingSession['kind'], number> = {
    'five-minute': expiresIn * 1000,
    'one-minute': (expiresIn - advance) * 1000,
    'one-day': DAY,
    within: 40 * MINUTE,
  };
  const sessions: IncomingSession[] = [
    // Its last request came before its refresh fell due, over five minutes
    // before the cutoff: idle past the window, it goes.
    {
      name: 'idle',
      userId: user.on,
      kind: 'five-minute',
      usedAt: -6,
      afterFirst: null,
      afterSecond: null,
    },
    // Its last request may have come up to five minutes after its
    // `"updatedAt"`, past the cutoff: stamped with the latest it can have
    // been, it stays; unused five minutes on, it goes.
    {
      name: 'used-early',
      userId: user.on,
      kind: 'five-minute',
      usedAt: -4,
      afterFirst: 1,
      afterSecond: null,
    },
    {
      name: 'used-late',
      userId: user.on,
      kind: 'five-minute',
      usedAt: -1,
      afterFirst: 4,
      afterSecond: null,
    },
    // Inside the window it stays; five minutes on, it is stamped in turn.
    {
      name: 'fresh',
      userId: user.on,
      kind: 'five-minute',
      usedAt: 3,
      afterFirst: 3,
      afterSecond: 3,
    },
    // Refreshed every minute: its `"updatedAt"` is its last use.
    {
      name: 'minutely-idle',
      userId: user.on,
      kind: 'one-minute',
      usedAt: -2,
      afterFirst: null,
      afterSecond: null,
    },
    {
      name: 'minutely-fresh',
      userId: user.on,
      kind: 'one-minute',
      usedAt: 2,
      afterFirst: 2,
      afterSecond: null,
    },
    // No window covers their users: neither stamped nor revoked.
    {
      name: 'open',
      userId: user.open,
      kind: 'five-minute',
      usedAt: -60,
      afterFirst: -60,
      afterSecond: -65,
    },
    {
      name: 'disabled',
      userId: user.disabled,
      kind: 'five-minute',
      usedAt: -2,
      afterFirst: -2,
      afterSecond: -7,
    },
    // Rows the clamp leaves as they are.
    {
      name: 'one-day',
      userId: user.on,
      kind: 'one-day',
      usedAt: 10,
      afterFirst: 10,
      afterSecond: 5,
    },
    {
      name: 'within',
      userId: user.on,
      kind: 'within',
      usedAt: 10,
      afterFirst: 10,
      afterSecond: 5,
    },
  ];
  const sessionId = (session: IncomingSession): string =>
    `${prefix}-${session.name}`;
  const written = (
    session: IncomingSession,
  ): SessionTimes & { createdAt: number } => {
    const updatedAt = cutoff + session.usedAt * MINUTE;
    return {
      // A "don't remember me" sign-in expires a day from its creation.
      createdAt:
        session.kind === 'one-day' ? updatedAt : updatedAt - 60 * MINUTE,
      updatedAt,
      expiresAt: updatedAt + lifetime[session.kind],
    };
  };
  // Under a set 30-minute variable, every longer-lived row but a "don't
  // remember me" one is stamped and expires a window after its stamp.
  const clampedTo = (session: IncomingSession): SessionTimes => {
    const { updatedAt, expiresAt } = written(session);
    if (session.kind === 'one-day' || session.kind === 'within') {
      return { updatedAt, expiresAt };
    }
    const stamp = updatedAt + 5 * MINUTE;
    return { updatedAt: stamp, expiresAt: stamp + windowMinutes * MINUTE };
  };
  const swept = (
    session: IncomingSession,
    at: number | null,
    moved: number,
  ): SessionTimes | undefined =>
    at === null
      ? undefined
      : {
          updatedAt: cutoff + at * MINUTE,
          expiresAt: written(session).expiresAt - moved * MINUTE,
        };
  const ids = sessions.map(sessionId);
  const orgIds = Object.values(org);
  const userIds = Object.values(user);
  const configRoot = process.env.TALE_CONFIG_DIR ?? '';

  const read = async (db: Sql): Promise<Map<string, SessionTimes>> => {
    const rows = await db<{ id: string; updatedAt: Date; expiresAt: Date }[]>`
      SELECT "id", "updatedAt", "expiresAt" FROM "session"
      WHERE "id" = ANY(${ids})
    `;
    return new Map(
      rows.map((row) => [
        row.id,
        {
          updatedAt: row.updatedAt.getTime(),
          expiresAt: row.expiresAt.getTime(),
        },
      ]),
    );
  };
  const shown = (times: SessionTimes | undefined): string =>
    times === undefined
      ? 'gone'
      : `${new Date(times.updatedAt).toISOString()}..${new Date(times.expiresAt).toISOString()}`;
  // Each session whose row is not as `want` has it, and what it is instead.
  const wrong = (
    got: ReadonlyMap<string, SessionTimes>,
    want: (session: IncomingSession) => SessionTimes | undefined,
  ): string =>
    sessions
      .flatMap((session) => {
        const is = shown(got.get(sessionId(session)));
        const should = shown(want(session));
        return is === should ? [] : [`${session.name}: ${is}, want ${should}`];
      })
      .join('; ');

  await withCleanup(
    [
      [
        'deletes its sessions',
        () => sql`DELETE FROM "session" WHERE "userId" = ANY(${userIds})`,
      ],
      [
        'deletes its memberships',
        () => sql`DELETE FROM "member" WHERE "userId" = ANY(${userIds})`,
      ],
      [
        'deletes its organizations',
        () => sql`DELETE FROM "organization" WHERE "id" = ANY(${orgIds})`,
      ],
      [
        'deletes its users',
        () => sql`DELETE FROM "user" WHERE "id" = ANY(${userIds})`,
      ],
      [
        'removes its policy file',
        () =>
          rm(path.join(configRoot, org.on), { recursive: true, force: true }),
      ],
    ],
    async () => {
      // On disk before its organization exists, so no read caches the
      // organization without its window.
      const dir = path.join(configRoot, org.on, 'governance');
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'session-idle-timeout.yml'),
        ['enabled: true', `idleTimeoutMinutes: ${windowMinutes}`].join('\n'),
      );
      clearOrgConfigCaches();
      const stamp = new Date(now);
      await sql`
        INSERT INTO "organization" ${sql(
          orgIds.map((id) => ({
            id,
            name: 'Idle stamp fixture',
            slug: id,
            createdAt: stamp,
          })),
        )}
      `;
      await sql`
        INSERT INTO "user" ${sql(
          userIds.map((id) => ({
            id,
            email: `${id}@example.test`,
            name: 'Idle stamp fixture',
            emailVerified: true,
            createdAt: stamp,
            updatedAt: stamp,
          })),
        )}
      `;
      await sql`
        INSERT INTO "member" ${sql(
          memberships.map(([userId, organizationId, role], index) => ({
            id: `${prefix}-member-${index}`,
            organizationId,
            userId,
            role,
            createdAt: new Date(now + index),
          })),
        )}
      `;
      await sql`
        INSERT INTO "session" ${sql(
          sessions.map((session) => {
            const row = written(session);
            return {
              id: sessionId(session),
              userId: session.userId,
              token: `tok-${sessionId(session)}`,
              createdAt: new Date(row.createdAt),
              updatedAt: new Date(row.updatedAt),
              expiresAt: new Date(row.expiresAt),
            };
          }),
        )}
      `;

      // What a set variable's clamp makes of the rows, rolled back. It reads
      // every session in the database: the count is at least the fixture's.
      const rollback = new Error('idle-stamp intentional rollback');
      let clamped = 0;
      let clampedRows: ReadonlyMap<string, SessionTimes> = new Map();
      await sql
        .begin(async (tx) => {
          clamped = await clampSessionsToIdleWindow(tx, {
            now,
            expiresIn: windowMinutes * 60,
          });
          clampedRows = await read(tx);
          throw rollback;
        })
        .catch((error: unknown) => {
          if (error !== rollback) throw error;
        });
      const longerLived = sessions.filter(
        (session) =>
          session.kind === 'five-minute' || session.kind === 'one-minute',
      ).length;
      const clampWrong = wrong(clampedRows, clampedTo);
      record(
        'idle sessions: a set SESSION_IDLE_TIMEOUT_MINUTES brings each longer-lived row under its window, stamped, but a "don\'t remember me" one',
        clamped >= longerLived && clampWrong === '',
        `clamped=${clamped} (want >= ${longerLived}), wrong=${clampWrong || 'none'}`,
      );

      const first = await revokeIdleSessions(sql, { now });
      const firstWrong = wrong(await read(sql), (session) =>
        swept(session, session.afterFirst, 0),
      );
      record(
        'idle sessions: a window coming into force stamps the five-minute rows that may be in use, and revokes the idle ones',
        firstWrong === '',
        `stamped=${first.stamped}, revoked=${first.revoked}, wrong=${firstWrong || 'none'}`,
      );

      // Five minutes on, with no request in between.
      await sql`
        UPDATE "session" SET
          "updatedAt" = "updatedAt" - make_interval(mins => 5),
          "expiresAt" = "expiresAt" - make_interval(mins => 5)
        WHERE "id" = ANY(${ids})
      `;
      const second = await revokeIdleSessions(sql, { now });
      const secondWrong = wrong(await read(sql), (session) =>
        swept(session, session.afterSecond, 5),
      );
      record(
        'idle sessions: five minutes on, a stamped row unused since goes, and the next five-minute row is stamped',
        secondWrong === '',
        `stamped=${second.stamped}, revoked=${second.revoked}, wrong=${secondWrong || 'none'}`,
      );
    },
  );
}
