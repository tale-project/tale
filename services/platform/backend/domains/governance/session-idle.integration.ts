/**
 * Real-Postgres proof of the idle-session sweep (`session-idle.ts`). Across
 * organizations with and without a window, a live session idle past the
 * strictest window its user has goes; a fresh one, one idle inside its
 * window, an expired one, a disabled member's and one whose user has no
 * window stay. Each revocation is audited once, to the organization whose
 * window decided it (of two sharing that window, the lower id), a window's
 * rows in one transaction. A window's statement walks
 * `session_updatedAt_expiresAt_idx` (`db/boot-indexes.ts`) in order.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Sql } from 'postgres';

import {
  errorText,
  type RecordCheck,
  withCleanup,
} from '../../integration-lane-helpers.ts';
import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import { idleSessionRevocation, revokeIdleSessions } from './session-idle.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export async function checkIdleSessionSweep(
  sql: Sql,
  record: RecordCheck,
): Promise<void> {
  const parts: ReadonlyArray<readonly [string, () => Promise<void>]> = [
    ['the plan of a window', () => checkWindowPlan(sql, record)],
    ['the sweep across organizations', () => checkAcrossOrgs(sql, record)],
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

/**
 * A window's statement takes the least recently used sessions first. On the
 * harness's handful of rows the planner may prefer any index plus a sort, so
 * sorting is ruled out as well: the plan must take that order from an index,
 * and only `session_updatedAt_expiresAt_idx` gives it.
 */
async function checkWindowPlan(sql: Sql, record: RecordCheck): Promise<void> {
  const now = Date.now();
  const plan = await sql.begin(async (tx) => {
    await tx`SET LOCAL enable_seqscan = off`;
    await tx`SET LOCAL enable_sort = off`;
    return tx<{ 'QUERY PLAN': string }[]>`
      EXPLAIN ${idleSessionRevocation(tx, {
        organizationIds: [randomUUID()],
        idleBefore: new Date(now - 15 * MINUTE),
        now: new Date(now),
        limit: 500,
      })}
    `;
  });
  const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
  record(
    'idle sessions: a window walks session_updatedAt_expiresAt_idx in order, unsorted',
    planText.includes('session_updatedAt_expiresAt_idx') &&
      !planText.includes('Sort'),
    planText,
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
